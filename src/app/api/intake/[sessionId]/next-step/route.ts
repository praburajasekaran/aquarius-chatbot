import { NextResponse } from "next/server";
import { pricingProbeLimiter } from "@/lib/rate-limit";
import { resolvePostUploadBookingStep } from "@/lib/post-upload-booking/resolve-post-upload-booking-step";
import type {
  PostUploadBookingStep,
  PublicPostUploadBookingStep,
} from "@/lib/post-upload-booking/types";

function publicStep(step: PostUploadBookingStep): PublicPostUploadBookingStep {
  if (step.kind === "unavailable") {
    return { kind: "unavailable" };
  }
  return step;
}

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
  const step = await resolvePostUploadBookingStep({ sessionId });
  if (step.kind === "unavailable") {
    console.warn("[intake-next-step] post-upload booking step unavailable", {
      event: "post_upload_booking_step_unavailable",
      sessionId,
      reason: step.reason,
    });
  }

  return NextResponse.json(publicStep(step));
}
