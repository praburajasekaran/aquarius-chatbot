import { NextResponse } from "next/server";
import { getIntake } from "@/lib/intake";
import { PRICING } from "@/lib/stripe";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
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
