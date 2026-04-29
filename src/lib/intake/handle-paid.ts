import { redis, getSession, createSession, updateSession } from "@/lib/kv";
import { createUploadToken, hashToken } from "@/lib/upload-tokens";
import { resend, sendTranscriptEmail } from "@/lib/resend";
import { getIntake } from "@/lib/intake";
import { sendSms } from "@/lib/sms/dispatch";
import { scheduleReminderSms } from "@/lib/sms/reminder";
import { IMMEDIATE_SMS_COPY, URGENT_FIRM_SMS_COPY } from "@/lib/sms/copy";
import { assertNoResendTracking } from "@/lib/email/assert-no-tracking";
import PaymentReceipt from "@/lib/email/payment-receipt";
import { BRANDING } from "@/lib/branding";

const DEDUPE_TTL_SECONDS = 60 * 60 * 24 * 7;

export type IntakePaidSource = "stripe" | "demo-bypass" | "bpoint";

export interface HandleIntakePaidArgs {
  /** Chat session ID (canonical reference shared across kv, intake, upload-tokens). */
  sessionId: string;
  /** Provider-specific receipt/session ref. Used for the firm transcript and audit. */
  paymentRef: string;
  /** Amount in cents (matches existing email/Zap payload shape). */
  paymentAmount: number;
  clientEmail: string;
  clientName: string;
  source: IntakePaidSource;
}

export interface HandleIntakePaidResult {
  status: "ok" | "duplicate";
  uploadLink?: string;
  rawToken?: string;
}

/**
 * Provider-agnostic post-payment fan-out (PHASE-03).
 *
 * Called by:
 *   - POST /api/intake/bypass-paid       (demo bypass success button)
 *   - POST /api/webhooks/stripe          (legacy Stripe path — to be migrated)
 *   - (future) POST /api/webhooks/bpoint (BPoint receipt webhook)
 *
 * Side-effects, in order:
 *   1. Mark session paid                        (kv.updateSession)
 *   2. Idempotency guard via `stripe-session:{sessionId}` NX SET
 *      (key name kept for compat with handleUploadCompleted's lookup)
 *   3. Mint upload token + persist hash in dedupe key
 *   4. Email payment receipt to client          (Resend, best-effort)
 *   5. Email firm transcript notification       (Resend, best-effort)
 *   6. Send IMMEDIATE_SMS_COPY to client phone  (ClickSend, never throws)
 *   7. Schedule 24h reminder SMS                (QStash, never throws)
 *
 * On duplicate event: returns `{ status: "duplicate" }` without firing
 * any side-effects. Caller should treat this as success (no retry needed).
 *
 * Throws ONLY on missing APP_URL — every other failure is logged + degraded.
 */
export async function handleIntakePaid(
  args: HandleIntakePaidArgs
): Promise<HandleIntakePaidResult> {
  const {
    sessionId,
    paymentRef,
    paymentAmount,
    clientEmail,
    clientName,
    source,
  } = args;

  // 1. Best-effort session marker — failure here must not block the fan-out.
  // The `session:` key has a 1h TTL and is only created by /api/upload, so on
  // a fresh post-payment fan-out it usually doesn't exist yet. Upsert: create
  // if missing, otherwise update. Either failure path is logged + degraded.
  try {
    const sessionData = {
      paymentStatus: "paid" as const,
      stripeSessionId: paymentRef,
      paymentAmount,
    };
    const existing = await getSession(sessionId);
    if (existing) {
      await updateSession(sessionId, sessionData);
    } else {
      await createSession(sessionId, sessionData);
    }
  } catch (err) {
    console.error("[intake] session upsert failed", {
      event: "intake_session_update_failed",
      sessionId,
      paymentRef,
      source,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // 2. Dedupe — key name `stripe-session:` is intentionally retained because
  //    src/lib/late-upload/handle-completed.ts looks up the upload-token hash
  //    by this key. Renaming requires touching that lookup too.
  const dedupeKey = `stripe-session:${sessionId}`;
  const created = await redis.set(dedupeKey, "pending", {
    nx: true,
    ex: DEDUPE_TTL_SECONDS,
  });
  if (created !== "OK") {
    console.info("[intake] duplicate paid event ignored", {
      event: "intake_duplicate",
      sessionId,
      source,
    });
    return { status: "duplicate" };
  }

  // 3. Upload token
  const { rawToken } = await createUploadToken({
    matterRef: sessionId,
    clientEmail,
    clientName,
    sessionId,
  });
  await redis.set(dedupeKey, hashToken(rawToken), {
    ex: DEDUPE_TTL_SECONDS,
  });

  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    throw new Error("APP_URL not configured");
  }
  const uploadLink = `${appUrl}/upload/${rawToken}`;

  // Load intake early — needed for receipt urgency routing AND firm transcript.
  // Best-effort: missing intake just means we send a receipt without an
  // urgency-specific next-step block.
  const intake = await getIntake(sessionId);

  // 4. Receipt email — best-effort
  const from = process.env.RESEND_FROM_EMAIL;
  if (from) {
    try {
      await assertNoResendTracking();
      const calendlyUrl =
        process.env.CALENDLY_BOOKING_URL ??
        "https://calendly.com/ekalaivan/advising-meeting";
      await resend.emails.send({
        from,
        to: clientEmail,
        subject: `Your payment receipt — ${BRANDING.firmName}`,
        react: PaymentReceipt({
          name: clientName || undefined,
          matterRef: sessionId,
          amountCents: paymentAmount,
          uploadLink,
          urgency: intake?.urgency ?? null,
          calendlyUrl,
          clientEmail,
        }),
      });
    } catch (err) {
      console.error("[intake] receipt email failed", {
        event: "intake_receipt_email_failed",
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    console.warn(
      "[intake] RESEND_FROM_EMAIL not set — receipt email skipped",
      { sessionId }
    );
  }

  // 5. Firm transcript — best-effort, requires intake record
  const storedTranscript = await redis
    .get<string>(`transcript:${sessionId}`)
    .catch(() => null);

  if (intake) {
    try {
      await sendTranscriptEmail({
        clientName: intake.clientName ?? clientName,
        clientEmail: intake.clientEmail ?? clientEmail,
        clientPhone: intake.clientPhone ?? "N/A",
        matterDescription: intake.matterDescription ?? "N/A",
        urgency: intake.urgency ?? "N/A",
        paymentAmount,
        stripeSessionId: paymentRef,
        transcript: storedTranscript ?? undefined,
      });
    } catch (err) {
      console.error("[intake] firm transcript email failed", {
        event: "intake_firm_email_failed",
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    console.warn("[intake] intake record missing — firm transcript skipped", {
      sessionId,
    });
  }

  // 6 + 7. Client SMS dispatch — both functions are absent-env-safe and never throw
  const phone = intake?.clientPhone;
  if (phone) {
    await sendSms(phone, IMMEDIATE_SMS_COPY(uploadLink));
    try {
      await scheduleReminderSms(sessionId, phone, uploadLink);
    } catch (err) {
      // scheduleReminderSms only throws on hard QStash failure (network/auth);
      // log and continue — the immediate SMS already went out.
      console.error("[intake] reminder schedule threw", {
        event: "intake_reminder_schedule_failed",
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    console.warn("[intake] no phone on intake — SMS skipped", {
      event: "intake_sms_skipped",
      reason: "no_phone",
      sessionId,
      source,
    });
  }

  // 8. Urgent-only firm staff SMS (PHASE-03)
  // Fires to the on-call mobile when an URGENT matter completes payment.
  // sendSms is absent-env-safe — missing FIRM_NOTIFY_PHONE or CLICKSEND_*
  // simply skips the dispatch. Non-urgent matters stay email-only.
  if (intake?.urgency === "urgent") {
    const firmPhone = process.env.FIRM_NOTIFY_PHONE;
    if (firmPhone) {
      await sendSms(
        firmPhone,
        URGENT_FIRM_SMS_COPY(
          intake.clientName ?? clientName,
          intake.clientPhone ?? ""
        )
      );
    } else {
      console.warn(
        "[intake] urgent matter but FIRM_NOTIFY_PHONE not set — firm SMS skipped",
        {
          event: "intake_firm_sms_skipped",
          reason: "no_firm_phone",
          sessionId,
        }
      );
    }
  }

  console.info("[intake] paid fan-out complete", {
    event: "intake_paid_complete",
    sessionId,
    source,
  });

  return { status: "ok", uploadLink, rawToken };
}
