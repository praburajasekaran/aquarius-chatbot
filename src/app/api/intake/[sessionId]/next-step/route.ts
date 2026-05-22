import { NextResponse } from "next/server";
import { getIntake } from "@/lib/intake";
import { pricingProbeLimiter } from "@/lib/rate-limit";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  let limitOk = true;
  try {
    const { success } = await pricingProbeLimiter.limit(ip);
    limitOk = success;
  } catch (err) {
    console.error("[intake-next-step] rate limiter unavailable, failing open", {
      event: "intake_next_step_ratelimit_unavailable",
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

  if (intake.urgency === "urgent") {
    return NextResponse.json({
      route: "urgent",
      input: { sessionId },
    });
  }

  return NextResponse.json({
    route: "schedule",
    input: {
      sessionId,
      prefillName: intake.clientName,
      prefillEmail: intake.clientEmail,
      matterDescription: intake.matterDescription,
    },
  });
}
