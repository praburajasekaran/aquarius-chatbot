import { NextResponse, type NextRequest } from "next/server";
import { createCheckoutSession, getStripe } from "@/lib/stripe";
import { getIntake, updateIntake } from "@/lib/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session");
  const appUrl = process.env.NEXT_PUBLIC_URL ?? "";

  if (!sessionId) {
    return NextResponse.redirect(`${appUrl}/?expired=1`);
  }

  const intake = await getIntake(sessionId);
  if (!intake) {
    return NextResponse.redirect(`${appUrl}/?expired=1`);
  }

  if (intake.bpointTxnNumber) {
    try {
      const existing = await getStripe().checkout.sessions.retrieve(intake.bpointTxnNumber);
      if (existing.status === "complete") {
        return NextResponse.redirect(`${appUrl}/?paid=1`);
      }
      if (existing.status === "open" && existing.url) {
        return NextResponse.redirect(existing.url);
      }
    } catch (err) {
      console.error("[checkout/resume] failed to retrieve existing Stripe session", err);
    }
  }

  const fresh = await createCheckoutSession({
    sessionId: intake.sessionId,
    urgency: intake.urgency,
    customerEmail: intake.clientEmail,
    returnUrlBase: appUrl,
    uiMode: "hosted_page",
  });

  await updateIntake(sessionId, { bpointTxnNumber: fresh.id });

  if (!fresh.url) {
    return NextResponse.redirect(`${appUrl}/?expired=1`);
  }

  return NextResponse.redirect(fresh.url);
}
