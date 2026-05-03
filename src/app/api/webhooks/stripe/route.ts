import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { handleIntakePaid } from "@/lib/intake/handle-paid";

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

    if (!sessionId) {
      console.error("[stripe-webhook] missing sessionId in metadata", {
        event: "stripe_missing_session_id",
        stripeSessionId: session.id,
      });
      return NextResponse.json({ received: true });
    }
    if (!clientEmail) {
      console.error("[stripe-webhook] missing client email", {
        event: "stripe_missing_email",
        stripeSessionId: session.id,
        sessionId,
      });
      return NextResponse.json({ received: true });
    }

    try {
      await handleIntakePaid({
        sessionId,
        paymentRef: session.id,
        paymentAmount: session.amount_total ?? 0,
        clientEmail,
        clientName,
        source: "stripe",
      });
    } catch (err) {
      // Webhook MUST return 200 regardless — otherwise Stripe retries forever.
      // handleIntakePaid only throws on missing APP_URL; everything else is
      // logged + degraded inside the orchestrator.
      console.error("[stripe-webhook] orchestrator threw", {
        event: "stripe_orchestrator_failed",
        stripeSessionId: session.id,
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ received: true });
}
