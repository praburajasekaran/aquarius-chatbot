import { NextResponse, type NextRequest } from "next/server";
import { createCheckoutSession, getStripe } from "@/lib/stripe";
import { getIntake, updateIntake } from "@/lib/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SESSION_ID_LENGTH = 200;

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session");
  const appUrl = process.env.NEXT_PUBLIC_URL ?? "";

  if (
    !sessionId ||
    sessionId.length === 0 ||
    sessionId.length > MAX_SESSION_ID_LENGTH
  ) {
    return NextResponse.redirect(`${appUrl}/?expired=1`);
  }

  let intake;
  try {
    intake = await getIntake(sessionId);
  } catch (err) {
    console.error("[checkout/resume] intake lookup failed", {
      event: "intake_lookup_failed",
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.redirect(`${appUrl}/?expired=1`);
  }
  if (!intake) {
    return NextResponse.redirect(`${appUrl}/?expired=1`);
  }

  if (intake.stripeSessionId) {
    try {
      const existing = await getStripe().checkout.sessions.retrieve(
        intake.stripeSessionId
      );
      if (existing.status === "complete") {
        return NextResponse.redirect(`${appUrl}/?paid=1`);
      }
      if (existing.status === "open" && existing.url) {
        return NextResponse.redirect(existing.url);
      }
    } catch (err) {
      console.error(
        "[checkout/resume] failed to retrieve existing Stripe session",
        {
          event: "stripe_retrieve_failed",
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        }
      );
    }
  }

  let fresh;
  try {
    fresh = await createCheckoutSession({
      sessionId: intake.sessionId,
      urgency: intake.urgency,
      customerEmail: intake.clientEmail,
      returnUrlBase: appUrl,
      uiMode: "hosted_page",
    });
  } catch (err) {
    console.error("[checkout/resume] stripe session creation failed", {
      event: "stripe_create_failed",
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.redirect(`${appUrl}/?expired=1`);
  }

  try {
    await updateIntake(sessionId, { stripeSessionId: fresh.id });
  } catch (err) {
    console.error("[checkout/resume] updateIntake failed", {
      event: "intake_update_failed",
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  if (!fresh.url) {
    return NextResponse.redirect(`${appUrl}/?expired=1`);
  }

  return NextResponse.redirect(fresh.url);
}
