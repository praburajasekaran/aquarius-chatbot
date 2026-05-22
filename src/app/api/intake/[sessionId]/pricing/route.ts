import { NextResponse } from "next/server";
import { getIntake } from "@/lib/intake";
import { PRICING } from "@/lib/pricing";
import { pricingProbeLimiter } from "@/lib/rate-limit";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  // Fail open if Redis blips — same trade as the chat route. The endpoint
  // is read-only and PII-light, so a brief uncapped window is acceptable.
  let limitOk = true;
  try {
    const { success } = await pricingProbeLimiter.limit(ip);
    limitOk = success;
  } catch (err) {
    console.error("[pricing] rate limiter unavailable, failing open", {
      event: "pricing_ratelimit_unavailable",
      err: err instanceof Error ? err.message : String(err),
    });
  }
  if (!limitOk) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const { sessionId } = await params;
  const intake = await getIntake(sessionId);
  if (!intake) {
    return NextResponse.json({ error: "Intake not found" }, { status: 404 });
  }
  const pricing = PRICING[intake.urgency];
  return NextResponse.json({
    urgency: intake.urgency,
    displayPrice: pricing.displayPrice,
    tier: pricing.tier,
    lineItem: pricing.lineItem,
  });
}
