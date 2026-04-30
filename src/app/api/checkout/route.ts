import { NextResponse } from "next/server";
import { z } from "zod";
import { createCheckoutSession, PRICING } from "@/lib/stripe";
import { getIntake, updateIntake } from "@/lib/intake";
import { parseJsonBody } from "@/lib/api/parse";

const Body = z.object({
  sessionId: z.string().min(1),
});

export async function POST(req: Request) {
  const parsed = await parseJsonBody(req, Body);
  if (!parsed.ok) return parsed.response;
  const { sessionId } = parsed.data;

  const intake = await getIntake(sessionId);
  if (!intake) {
    return NextResponse.json({ error: "intake_not_found" }, { status: 404 });
  }

  if (!PRICING[intake.urgency]) {
    return NextResponse.json({ error: "invalid_urgency" }, { status: 422 });
  }

  let checkoutSession;
  try {
    checkoutSession = await createCheckoutSession({
      sessionId,
      urgency: intake.urgency,
      returnUrlBase: process.env.NEXT_PUBLIC_URL ?? "",
    });
  } catch (err) {
    console.error("[checkout] stripe session creation failed", {
      event: "checkout_create_failed",
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "checkout_create_failed" },
      { status: 502 }
    );
  }

  try {
    await updateIntake(sessionId, { stripeSessionId: checkoutSession.id });
  } catch (err) {
    console.error("[checkout] failed to persist stripeSessionId to intake", err);
  }

  return NextResponse.json({ clientSecret: checkoutSession.client_secret });
}
