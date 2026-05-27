import { redis, getSession, createSession, updateSession } from "@/lib/kv";
import {
  createUploadToken,
  hashToken,
  revokeTokenByHash,
} from "@/lib/upload-tokens";
import {
  sendAndLog,
  sendFirmIntegrationAlertEmail,
  sendTranscriptEmail,
} from "@/lib/resend";
import { getIntake } from "@/lib/intake";
import { buildCreateMatterZapPayload } from "@/lib/smokeball/create-matter";
import { sendSms } from "@/lib/sms/dispatch";
import { scheduleReminderSms } from "@/lib/sms/reminder";
import { sendToZapier } from "@/lib/zapier";
import { IMMEDIATE_SMS_COPY, URGENT_FIRM_SMS_COPY } from "@/lib/sms/copy";
import { assertNoResendTracking } from "@/lib/email/assert-no-tracking";
import PaymentReceipt from "@/lib/email/payment-receipt";
import { BRANDING } from "@/lib/branding";
import { cancelEmailReminder } from "@/lib/email-reminders/dispatch";
import { logActivity } from "@/lib/digest/activity-log";

const DEDUPE_TTL_SECONDS = 60 * 60 * 24 * 7;

export type IntakePaidSource = "bpoint";

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
 *   - GET  /api/checkout/confirm         (BPoint browser return)
 *   - POST /api/webhooks/bpoint          (BPoint safety-net callback)
 *
 * Side-effects, in order:
 *   1. Mark session paid                        (kv.updateSession)
 *   2. Idempotency guard via `payment-session:{sessionId}` NX SET
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
      paymentRef,
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

  // 2 + 3. Dedupe and upload-token mint, atomically.
  //
  // Old behaviour was a two-step "SET NX 'pending'" → mint → "SET hash"
  // sequence. If the function timed out between those (Resend, SMS, and
  // QStash calls each take meaningful time), the dedupe key was left at
  // "pending" for the full 7-day TTL. Payment retries would then see
  // "duplicate" and return early — but no upload token had ever been
  // created or emailed, leaving the client in a paid-no-token deadlock
  // recoverable only by manual Redis surgery.
  //
  // New approach: mint the token first, then atomically SET NX with the
  // final hash. Minting before claiming means we may produce an orphan
  // token if we lose the race against a concurrent peer — we revoke
  // those before returning. We also detect legacy "pending" values left
  // by the old code path and clear them so existing stuck records can
  // self-heal.
  const dedupeKey = `payment-session:${sessionId}`;
  const { rawToken } = await createUploadToken({
    matterRef: sessionId,
    clientEmail,
    clientName,
    sessionId,
  });
  const tokenHashHex = hashToken(rawToken);

  let claimed = false;
  for (let attempt = 0; attempt < 2 && !claimed; attempt++) {
    const result = await redis.set(dedupeKey, tokenHashHex, {
      nx: true,
      ex: DEDUPE_TTL_SECONDS,
    });
    if (result === "OK") {
      claimed = true;
      break;
    }
    // Probe what's there. A real prior winner stores a hex hash
    // (length 64); the legacy two-step bug stored "pending". Recover
    // from "pending" exactly once — clear and retry SET NX. Real prior
    // winners are duplicate events.
    const existing = await redis.get<string>(dedupeKey);
    if (existing === "pending" && attempt === 0) {
      console.warn("[intake] recovering stuck 'pending' dedupe key", {
        event: "intake_dedupe_recovery",
        sessionId,
        source,
      });
      await redis.del(dedupeKey);
      continue;
    }
    break;
  }

  if (!claimed) {
    // Concurrent peer beat us, or recovery itself raced. Revoke the
    // orphan token we minted so it isn't dangling in Redis.
    try {
      await revokeTokenByHash(tokenHashHex);
    } catch (err) {
      console.error("[intake] orphan token revoke failed", {
        event: "intake_orphan_revoke_failed",
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    console.info("[intake] duplicate paid event ignored", {
      event: "intake_duplicate",
      sessionId,
      source,
    });
    return { status: "duplicate" };
  }

  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    throw new Error("APP_URL not configured");
  }
  const uploadLink = `${appUrl}/upload/${rawToken}`;

  // Load intake early — needed for receipt urgency routing AND firm transcript.
  // Best-effort: missing intake just means we send a receipt without an
  // urgency-specific next-step block.
  const intake = await getIntake(sessionId);

  // Pre-fetch the stored transcript so both the client receipt and the firm
  // notification can include it. Failure here is non-fatal — both emails
  // degrade to "no conversation summary" rather than fail the fan-out.
  const storedTranscript = await redis
    .get<string>(`transcript:${sessionId}`)
    .catch(() => null);

  // 4. Smokeball create-matter Zap — best-effort with firm alert on hard failure.
  // This intentionally excludes the full transcript; Zap #1 receives only the
  // Matter Summary and payment/contact metadata.
  if (intake) {
    const createMatterUrl = process.env.ZAPIER_WEBHOOK_URL;
    try {
      if (!createMatterUrl) throw new Error("ZAPIER_WEBHOOK_URL not configured");
      await sendToZapier(
        createMatterUrl,
        buildCreateMatterZapPayload({
          sessionId,
          paymentRef,
          paymentAmount,
          intake,
        })
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error("[intake] create-matter Zap failed", {
        event: "intake_create_matter_zap_failed",
        sessionId,
        paymentRef,
        err: reason,
      });
      try {
        await sendFirmIntegrationAlertEmail({
          title: "Smokeball matter creation failed",
          reason,
          sessionId,
          clientName: intake.clientName,
          clientEmail: intake.clientEmail,
          details: {
            "Payment reference": paymentRef,
            Urgency: intake.urgency,
            "Matter summary": intake.matterDescription,
          },
        });
      } catch (alertErr) {
        console.error("[intake] create-matter firm alert failed", {
          event: "intake_create_matter_alert_failed",
          sessionId,
          err:
            alertErr instanceof Error ? alertErr.message : String(alertErr),
        });
      }
    }
  }

  // 5. Receipt email — best-effort
  const from = process.env.RESEND_FROM_EMAIL;
  if (from) {
    try {
      await assertNoResendTracking();
      // PaymentReceipt only renders the Calendly block when both `urgency`
      // is "non-urgent" AND `calendlyUrl` is set, so a missing env var just
      // drops that block instead of failing the entire receipt send.
      const calendlyUrl = process.env.CALENDLY_BOOKING_URL;
      if (!calendlyUrl) {
        console.warn(
          "[intake] CALENDLY_BOOKING_URL not set — receipt sent without booking link",
          { event: "intake_receipt_no_calendly", sessionId }
        );
      }
      await sendAndLog(
        {
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
            transcript: storedTranscript ?? undefined,
          }),
        },
        { event: "intake_receipt", sessionId }
      );
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

  // 6. Firm transcript — best-effort, requires intake record
  if (intake) {
    try {
      await sendTranscriptEmail({
        clientName: intake.clientName ?? clientName,
        clientEmail: intake.clientEmail ?? clientEmail,
        clientPhone: intake.clientPhone ?? "N/A",
        matterDescription: intake.matterDescription ?? "N/A",
        urgency: intake.urgency ?? "N/A",
        paymentAmount,
        paymentRef,
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

  // 7 + 8. Client SMS dispatch — both functions are absent-env-safe and never throw
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

  // 9. Urgent-only firm staff SMS (PHASE-03)
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

  // PAY-02: cancel both pending payment-abandonment reminders. Each call is
  // idempotent and absent-env-safe (returns early when QSTASH_TOKEN missing).
  // Cancellation runs LAST in the fan-out so it executes even if a prior
  // best-effort step (receipt, transcript, SMS) failed.
  try {
    await cancelEmailReminder("payment-abandonment-1h", sessionId);
  } catch (err) {
    console.error("[intake] cancel 1h email reminder threw", {
      event: "intake_email_reminder_cancel_failed",
      type: "payment-abandonment-1h",
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
  try {
    await cancelEmailReminder("payment-abandonment-24h", sessionId);
  } catch (err) {
    console.error("[intake] cancel 24h email reminder threw", {
      event: "intake_email_reminder_cancel_failed",
      type: "payment-abandonment-24h",
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // PAY-02 + Decision 6 (defence-in-depth): durable cancellation-state guard
  // read at delivery time by the email-reminder route handler. Even if cancel
  // races with delivery, the delivery handler short-circuits when this key
  // is set. TTL = 26h (93600s) — covers the 24h reminder window with grace.
  try {
    await redis.set(`payment-completed:${sessionId}`, "1", { ex: 26 * 3600 });
  } catch (err) {
    console.error("[intake] payment-completed key write failed", {
      event: "intake_payment_completed_key_failed",
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // Decision 3 (04-CONTEXT.md): log payment_completed activity. logActivity
  // is internally isolated — this try/catch is defence-in-depth.
  try {
    await logActivity("payment_completed", sessionId, {
      paymentRef,
      paymentAmount,
      source,
    });
  } catch {
    /* logActivity is internally isolated; defence-in-depth */
  }

  console.info("[intake] paid fan-out complete", {
    event: "intake_paid_complete",
    sessionId,
    source,
  });

  return { status: "ok", uploadLink, rawToken };
}
