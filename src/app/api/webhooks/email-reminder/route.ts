import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { redis } from "@/lib/kv";
import {
  isPaymentCompleted,
  isUnsubscribed,
  tryClaimDelivery,
  deliveryNxKey,
} from "@/lib/email-reminders/state";
import type {
  EmailReminderType,
  EmailReminderPayload,
} from "@/lib/email-reminders/dispatch";
import {
  assertCopyApproved,
  PAYMENT_1H_SUBJECT,
  PAYMENT_24H_SUBJECT,
} from "@/lib/email-reminders/copy";
import { signUnsubscribeToken } from "@/lib/email-reminders/unsubscribe";
import { getIntake } from "@/lib/intake";
import { sendAndLog } from "@/lib/resend";
import { assertNoResendTracking } from "@/lib/email/assert-no-tracking";
import { logActivity } from "@/lib/digest/activity-log";
import ReengagementPaymentEmail from "@/lib/email/templates/reengagement-payment";

/**
 * QStash delivery target for the v1.1 payment-abandonment reminders.
 *
 * Order of operations (Plan 04-03 contract — locked by dispatch.test.ts):
 *   1. Parse + validate payload (sessionId + type narrowing)
 *   2. INFRA-04 cancellation-state gate: short-circuit if payment-completed:{sessionId}
 *   3. INFRA-04 visitor-opt-out gate:    short-circuit if unsubscribe:{sessionId}
 *   4. INFRA-05 NX dedup claim:          email-reminder-sent:{type}:{sessionId} with ex=604800 (7d)
 *   5. Decision 1 production guard:      assertCopyApproved() — throws in production if PENDING_SIGNOFF
 *   6. Load intake from Redis            (Decision: re-read at delivery time, not embedded in QStash payload)
 *   7. Construct resume + unsubscribe URLs (HMAC-signed unsubscribe per INFRA-07)
 *   8. Resend dispatch via sendAndLog    (release NX claim on send-failure so QStash retries can re-attempt)
 *   9. Decision 3 activity log:          payment_abandoned_1h | payment_abandoned_24h post-send only
 *  10. OPS-V1.1-02 success log + 200 ok
 */

const DELIVERY_NX_TTL_SECONDS = 7 * 24 * 3600; // 7d = 604800 (INFRA-05)

function isValidType(t: unknown): t is EmailReminderType {
  return t === "payment-abandonment-1h" || t === "payment-abandonment-24h";
}

export async function handleEmailReminderDelivery(
  req: Request
): Promise<Response> {
  const body = (await req.json()) as Partial<EmailReminderPayload>;
  const sessionId = body?.sessionId ?? "";
  const type = body?.type;

  if (!sessionId || !isValidType(type)) {
    console.warn("[email-reminder] invalid payload", {
      event: "email_reminder_failed",
      reason: "invalid_payload",
      sessionId,
      type,
    });
    return new Response("invalid_payload", { status: 400 });
  }

  // INFRA-04: cancellation-state gate (read BEFORE NX claim).
  if (await isPaymentCompleted(sessionId)) {
    console.info("[email-reminder] skipped — payment completed", {
      event: "email_reminder_skipped",
      reason: "payment_completed",
      type,
      sessionId,
    });
    return new Response("skipped");
  }

  // INFRA-04: visitor opt-out gate (read BEFORE NX claim).
  if (await isUnsubscribed(sessionId)) {
    console.info("[email-reminder] skipped — unsubscribed", {
      event: "email_reminder_skipped",
      reason: "unsubscribed",
      type,
      sessionId,
    });
    return new Response("skipped");
  }

  // INFRA-05: NX claim against duplicate QStash delivery.
  const claimed = await tryClaimDelivery(
    type,
    sessionId,
    DELIVERY_NX_TTL_SECONDS
  );
  if (!claimed) {
    console.info("[email-reminder] skipped — duplicate delivery", {
      event: "email_reminder_skipped",
      reason: "duplicate_delivery",
      type,
      sessionId,
    });
    return new Response("deduped");
  }

  // Decision 1: production guard — fail loud if any locked-copy field is still
  // PENDING_SIGNOFF when NODE_ENV === "production". Outside production this is
  // a no-op so PR previews/tests/dev keep working with placeholder copy.
  // If this throws in production, QStash will retry — which is correct: the
  // deploy is broken, retries surface the failure to ops.
  assertCopyApproved();

  // Re-read intake at delivery time (Decision in 04-CONTEXT) to keep the
  // QStash payload small and avoid stale data.
  const intake = await getIntake(sessionId);
  if (!intake) {
    console.warn("[email-reminder] intake missing — skipping send", {
      event: "email_reminder_failed",
      reason: "intake_missing",
      sessionId,
      type,
    });
    // Don't release NX claim — intake is gone, retries can't help.
    return new Response("intake_missing");
  }

  // APP_URL absent is non-fatal at delivery time: the email still sends
  // (intake email succeeded an hour ago, so the visitor has the original
  // confirmation in their inbox), and the resume + unsubscribe links degrade
  // to relative URLs the visitor can paste into the browser. We warn so ops
  // notices the misconfig but DO NOT release the NX claim — the email
  // already shipped on this delivery attempt.
  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    console.warn("[email-reminder] APP_URL missing — links will be relative", {
      event: "email_reminder_skipped",
      reason: "no_app_url",
      sessionId,
      type,
    });
  }

  const baseUrl = appUrl ?? "";
  const resumeUrl = `${baseUrl}/api/checkout/resume?session=${encodeURIComponent(sessionId)}`;
  const token = signUnsubscribeToken(sessionId);
  // If the secret is absent, signUnsubscribeToken returns null + warns; we
  // still render an unsubscribe URL with an empty token so the email body
  // is well-formed. The unsubscribe handler will reject the empty/invalid
  // token with a 400 — graceful degradation, not a crash.
  const unsubscribeUrl = `${baseUrl}/api/email/unsubscribe?session=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token ?? "")}`;

  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) {
    console.warn("[email-reminder] RESEND_FROM_EMAIL missing — skipping send", {
      event: "email_reminder_skipped",
      reason: "no_resend_from",
      sessionId,
      type,
    });
    // Release NX claim so a future redeploy with RESEND_FROM_EMAIL can retry.
    await redis.del(deliveryNxKey(type, sessionId));
    return new Response("no_resend_from");
  }

  try {
    await assertNoResendTracking();
    const subject =
      type === "payment-abandonment-1h"
        ? PAYMENT_1H_SUBJECT
        : PAYMENT_24H_SUBJECT;
    await sendAndLog(
      {
        from,
        to: intake.clientEmail,
        subject,
        react: ReengagementPaymentEmail({
          variant: type === "payment-abandonment-1h" ? "1h" : "24h",
          clientName: intake.clientName ?? "",
          matterDescription: intake.matterDescription ?? "",
          resumeUrl,
          unsubscribeUrl,
        }),
      },
      { event: "email_reminder_sent", sessionId }
    );
  } catch (err) {
    console.error("[email-reminder] send failed", {
      event: "email_reminder_failed",
      type,
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    // Release NX claim so QStash redelivery can retry.
    await redis.del(deliveryNxKey(type, sessionId));
    return new Response("send_failed", { status: 500 });
  }

  // Decision 3: log activity AFTER successful send only.
  await logActivity(
    type === "payment-abandonment-1h"
      ? "payment_abandoned_1h"
      : "payment_abandoned_24h",
    sessionId,
    { type }
  );

  console.info("[email-reminder] reminder delivered", {
    event: "email_reminder_sent",
    type,
    sessionId,
  });
  return new Response("ok");
}

// INFRA-03: every real POST runs through QStash signature verification.
//
// LAZY WRAPPING (mirrors src/app/api/webhooks/sms-reminder/route.ts:55-71):
// verifySignatureAppRouter() reads QSTASH_CURRENT_SIGNING_KEY +
// QSTASH_NEXT_SIGNING_KEY synchronously and throws if either is missing.
// Calling it at module load makes Next.js's "collect page data" build crash
// on PR previews and local dev when the keys aren't set, violating the
// project-wide "absent-safe env var" principle. Defer construction to
// first request and memoise the result.
let cachedHandler: ((req: Request) => Promise<Response>) | null = null;

export async function POST(req: Request): Promise<Response> {
  if (!cachedHandler) {
    cachedHandler = verifySignatureAppRouter(handleEmailReminderDelivery);
  }
  return cachedHandler(req);
}
