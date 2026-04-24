import { updateSession, redis } from "@/lib/kv";
import { getIntake } from "@/lib/intake";
import { createUploadToken, hashToken } from "@/lib/upload-tokens";
import { resend, sendTranscriptEmail } from "@/lib/resend";
import { assertNoResendTracking } from "@/lib/email/assert-no-tracking";
import PaymentReceipt from "@/lib/email/payment-receipt";
import { BRANDING } from "@/lib/branding";

// Matches the existing stripe-session:* dedup TTL (7 days). The confirm
// route sets bpoint-txn:{TxnNumber} = "pending" via SETNX BEFORE calling
// this helper; here we UPGRADE the value to hashToken(rawToken) so a later
// upload-link verification can correlate the upload with the txn.
const DEDUPE_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface HandleConfirmedPaymentArgs {
  sessionId: string;
  bpointTxnNumber: string;
  amountCents: number;
}

/**
 * Shared post-payment fan-out: session update, upload token, receipt email,
 * firm transcript email. Imported by:
 *   - GET /api/checkout/confirm  (Phase 2)
 *   - POST /api/webhooks/bpoint   (Phase 3)
 *
 * Caller MUST wrap in try/catch — fan-out failures must not propagate to
 * the user-facing redirect (confirm route) or webhook 200 (Phase 3).
 *
 * Throws when:
 *   - getIntake returns null (sessionId unknown / Redis evicted) — caller
 *     should log and redirect to system-error path; do NOT swallow.
 *   - APP_URL or RESEND_FROM_EMAIL not configured (env misconfig).
 *   - Any downstream call (Resend, Zapier) throws.
 */
export async function handleConfirmedPayment(
  args: HandleConfirmedPaymentArgs
): Promise<void> {
  const { sessionId, bpointTxnNumber, amountCents } = args;

  const intake = await getIntake(sessionId);
  if (!intake) {
    throw new Error(
      `[payments] no intake for sessionId=${sessionId} (txn=${bpointTxnNumber})`
    );
  }

  // 1. Session update — paid + identifiers. updateSession throws if the
  //    session has expired; let it propagate.
  await updateSession(sessionId, {
    paymentStatus: "paid",
    bpointTxnNumber,
    paymentAmount: amountCents,
  });

  // 2. Upload token — gives the client a one-time link to send documents.
  const { rawToken } = await createUploadToken({
    matterRef: sessionId,
    clientEmail: intake.clientEmail,
    clientName: intake.clientName,
    sessionId,
  });

  // 3. Upgrade dedup key from "pending" to token hash. Confirm route
  //    already SETNX'd "pending"; this overwrite preserves the TTL window.
  const dedupeKey = `bpoint-txn:${bpointTxnNumber}`;
  await redis.set(dedupeKey, hashToken(rawToken), {
    ex: DEDUPE_TTL_SECONDS,
  });

  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    throw new Error("[payments] APP_URL not configured");
  }
  const uploadLink = `${appUrl}/upload/${rawToken}`;

  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) {
    throw new Error("[payments] RESEND_FROM_EMAIL not configured");
  }

  await assertNoResendTracking();

  // 4. Receipt email to client.
  await resend.emails.send({
    from,
    to: intake.clientEmail,
    subject: `Your payment receipt — ${BRANDING.firmName}`,
    react: PaymentReceipt({
      name: intake.clientName || undefined,
      matterRef: sessionId,
      amountCents,
      uploadLink,
    }),
  });

  // 5. Firm transcript email (Zapier → Smokeball).
  await sendTranscriptEmail({
    clientName: intake.clientName,
    clientEmail: intake.clientEmail,
    clientPhone: intake.clientPhone || "N/A",
    matterDescription: intake.matterDescription || "N/A",
    urgency: intake.urgency,
    paymentAmount: amountCents,
    bpointTxnNumber,
  });
}
