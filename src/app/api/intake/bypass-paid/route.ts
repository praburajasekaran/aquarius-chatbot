import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getIntake } from "@/lib/intake";
import { handleIntakePaid } from "@/lib/intake/handle-paid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PayloadSchema = z.object({
  sessionId: z.string().min(1),
});

/**
 * Demo-only payment-bypass endpoint.
 *
 * Triggered by DemoPaymentCard's "Pay (Success)" button while the firm is
 * in the gap between Stripe (deprecated) and BPoint (in flight). Runs the
 * same `handleIntakePaid()` orchestrator that the real payment webhooks
 * will run — proving the provider-agnostic seam without depending on a
 * real payment processor.
 *
 * Refuses unless `NEXT_PUBLIC_DEMO_BYPASS_PAYMENT === "true"` so this
 * endpoint cannot be used to mint upload tokens against real intake
 * records in a non-demo deployment.
 */
export async function POST(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_DEMO_BYPASS_PAYMENT !== "true") {
    return NextResponse.json(
      { error: "demo_bypass_disabled" },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const parsed = PayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_payload" }, { status: 400 });
  }
  const { sessionId } = parsed.data;

  const intake = await getIntake(sessionId);
  if (!intake) {
    return NextResponse.json({ error: "intake_not_found" }, { status: 404 });
  }

  try {
    const result = await handleIntakePaid({
      sessionId,
      paymentRef: `demo_${sessionId}`,
      paymentAmount: intake.amountCents,
      clientEmail: intake.clientEmail,
      clientName: intake.clientName,
      source: "demo-bypass",
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[bypass-paid] orchestrator threw", {
      event: "bypass_orchestrator_failed",
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "orchestrator_failed" },
      { status: 500 }
    );
  }
}
