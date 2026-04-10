import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { updateSession } from "@/lib/kv";

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

    if (sessionId) {
      try {
        await updateSession(sessionId, {
          paymentStatus: "paid",
          stripeSessionId: session.id,
          paymentAmount: session.amount_total,
        });
      } catch {
        // Session may have expired — log for manual follow-up
        console.error(
          `Failed to update session ${sessionId} after payment. Stripe session: ${session.id}`
        );
      }
    }
  }

  return NextResponse.json({ received: true });
}
