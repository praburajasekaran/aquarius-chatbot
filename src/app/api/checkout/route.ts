import { NextResponse } from "next/server";
import { createCheckoutSession, PRICING } from "@/lib/stripe";
import { getIntake, updateIntake } from "@/lib/intake";

export async function POST(req: Request) {
  const { sessionId } = (await req.json()) as { sessionId: string };

  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const intake = await getIntake(sessionId);
  if (!intake) {
    return NextResponse.json(
      { error: "No intake record found. Please complete the urgency selection step." },
      { status: 409 }
    );
  }

  const urgency = intake.urgency;
  if (!PRICING[urgency]) {
    return NextResponse.json({ error: "Invalid urgency in intake" }, { status: 500 });
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
