import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { updateSession, redis } from "@/lib/kv";
import { createUploadToken, hashToken } from "@/lib/upload-tokens";
import { resend, sendTranscriptEmail } from "@/lib/resend";
import { getIntake } from "@/lib/intake";
import PaymentReceipt from "@/lib/email/payment-receipt";
import { assertNoResendTracking } from "@/lib/email/assert-no-tracking";
import { BRANDING } from "@/lib/branding";

const DEDUPE_TTL_SECONDS = 60 * 60 * 24 * 7;

export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "No signature" }, { status: 400 });
  }

  let event;
  try {
    event = getStripe().webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Webhook Error: ${message}` },
      { status: 400 }
    );
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const sessionId = session.metadata?.sessionId;
    const clientEmail =
      session.customer_details?.email ?? session.customer_email ?? null;
    const clientName = session.customer_details?.name ?? "";

    if (sessionId) {
      try {
        await updateSession(sessionId, {
          paymentStatus: "paid",
          bpointTxnNumber: session.id,
          paymentAmount: session.amount_total,
        });
      } catch {
        console.error(
          `[stripe-webhook] session update failed ${sessionId} / ${session.id}`
        );
      }
    }

    if (sessionId && clientEmail) {
      try {
        const dedupeKey = `stripe-session:${session.id}`;
        const created = await redis.set(dedupeKey, "pending", {
          nx: true,
          ex: DEDUPE_TTL_SECONDS,
        });
        if (created !== "OK") {
          console.info(
            `[stripe-webhook] retry ignored for ${session.id} (already processed)`
          );
          return NextResponse.json({ received: true });
        }

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

        const from = process.env.RESEND_FROM_EMAIL;
        if (!from) {
          throw new Error("RESEND_FROM_EMAIL not configured");
        }

        await assertNoResendTracking();

        await resend.emails.send({
          from,
          to: clientEmail,
          subject: `Your payment receipt — ${BRANDING.firmName}`,
          react: PaymentReceipt({
            name: clientName || undefined,
            matterRef: sessionId,
            amountCents: session.amount_total ?? 0,
            uploadLink,
          }),
        });

        // Notify firm about the paid inquiry
        const intake = await getIntake(sessionId);
        await sendTranscriptEmail({
          clientName: intake?.clientName ?? clientName,
          clientEmail: intake?.clientEmail ?? clientEmail,
          clientPhone: intake?.clientPhone ?? "N/A",
          matterDescription: intake?.matterDescription ?? "N/A",
          urgency: intake?.urgency ?? "N/A",
          paymentAmount: session.amount_total ?? 0,
          bpointTxnNumber: session.id,
        });
      } catch (err) {
        // Webhook MUST return 200 regardless — otherwise Stripe retries forever
        console.error("[stripe-webhook] token/email fan-out failed", {
          bpointTxnNumber: session.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return NextResponse.json({ received: true });
}
