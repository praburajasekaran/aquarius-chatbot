import { NextResponse, type NextRequest } from "next/server";
import { createCheckoutSession, getStripe } from "@/lib/stripe";
import { getIntake, updateIntake } from "@/lib/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SESSION_ID_LENGTH = 200;

// Whitelist for Stripe-returned URLs we redirect to. We pin the prefix
// rather than blindly trusting whatever Stripe handed back: the
// stripeSessionId we use to retrieve the checkout was originally
// derived from intake records that live in attacker-influenceable
// Redis state, so an attacker who can plant a sessionId from their own
// Stripe account could otherwise steer this redirect anywhere Stripe
// permits. This app does not use Stripe custom-domain checkout, so the
// canonical `checkout.stripe.com` prefix is sufficient.
const STRIPE_CHECKOUT_URL_PREFIX = "https://checkout.stripe.com/";

function isStripeCheckoutUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && url.startsWith(STRIPE_CHECKOUT_URL_PREFIX);
}

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
      if (existing.status === "open" && isStripeCheckoutUrl(existing.url)) {
        return NextResponse.redirect(existing.url);
      }
      if (existing.status === "open" && existing.url) {
        console.error("[checkout/resume] non-Stripe URL on existing session", {
          event: "checkout_resume_unexpected_url",
          sessionId,
          urlHost: safeHost(existing.url),
        });
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

  if (!isStripeCheckoutUrl(fresh.url)) {
    if (fresh.url) {
      console.error("[checkout/resume] non-Stripe URL on fresh session", {
        event: "checkout_resume_unexpected_fresh_url",
        sessionId,
        urlHost: safeHost(fresh.url),
      });
    }
    return NextResponse.redirect(`${appUrl}/?expired=1`);
  }

  return NextResponse.redirect(fresh.url);
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unparseable";
  }
}
