import { NextResponse, type NextRequest } from "next/server";
import { createAuthKey } from "@/lib/bpoint";
import { getIntake, updateIntake } from "@/lib/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/checkout/resume?session=<sessionId>
 *
 * Resume link handler for users who close the payment tab mid-flow. BPoint
 * has no retrieve-by-AuthKey endpoint (v2), so the safe pattern is to
 * always issue a fresh AuthKey on resume. Prior AuthKeys stored on intake
 * are overwritten via updateIntake.
 *
 * Locked decision (03-CONTEXT.md §"checkout/resume route"):
 *   - Always create a fresh AuthKey — no "reuse if still within TTL"
 *     branch, because BPoint exposes no AuthKey status check.
 *   - Redirect to /?payment=resume — chat-widget re-mounts PaymentCard
 *     with the new AuthKey pulled from intake.
 *   - createAuthKey failures redirect to /?expired=1, never 5xx.
 *
 * Logging tag: [checkout/resume]
 */
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

  try {
    const authKey = await createAuthKey({
      sessionId: intake.sessionId,
      urgency: intake.urgency,
      redirectionUrlBase: appUrl,
      webhookUrlBase: appUrl,
    });
    await updateIntake(sessionId, { bpointTxnNumber: authKey });
    return NextResponse.redirect(`${appUrl}/?payment=resume`);
  } catch (err) {
    console.error("[checkout/resume] failed to create fresh AuthKey", {
      tag: "[checkout/resume]",
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.redirect(`${appUrl}/?expired=1`);
  }
}
