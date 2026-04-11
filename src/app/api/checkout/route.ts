import { NextResponse } from "next/server";
import { createCheckoutSession, PRICING } from "@/lib/stripe";
import { updateIntake } from "@/lib/intake";

export async function POST(req: Request) {
  const { sessionId, urgency } = (await req.json()) as {
    sessionId: string;
    urgency: "urgent" | "non-urgent";
  };

  if (!PRICING[urgency]) {
    return NextResponse.json({ error: "Invalid urgency" }, { status: 400 });
  }

  const checkoutSession = await createCheckoutSession({
    sessionId,
    urgency,
    returnUrlBase: process.env.NEXT_PUBLIC_URL ?? "",
  });

  try {
    await updateIntake(sessionId, { stripeSessionId: checkoutSession.id });
  } catch (err) {
    console.error("[checkout] failed to persist stripeSessionId to intake", err);
  }

  return NextResponse.json({ clientSecret: checkoutSession.client_secret });
}
