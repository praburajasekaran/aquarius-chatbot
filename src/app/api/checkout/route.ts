import { NextResponse } from "next/server";
import { PRICING } from "@/lib/pricing";
import { createAuthKey } from "@/lib/bpoint";
import { updateIntake } from "@/lib/intake";

export async function POST(req: Request) {
  const { sessionId, urgency } = (await req.json()) as {
    sessionId: string;
    urgency: "urgent" | "non-urgent";
  };

  if (!PRICING[urgency]) {
    return NextResponse.json({ error: "Invalid urgency" }, { status: 400 });
  }

  try {
    const authKey = await createAuthKey({
      sessionId,
      urgency,
      redirectionUrlBase: process.env.NEXT_PUBLIC_URL ?? "",
    });

    try {
      await updateIntake(sessionId, { bpointTxnNumber: authKey });
    } catch (err) {
      console.error(
        "[checkout] failed to persist bpointTxnNumber to intake",
        err
      );
    }

    return NextResponse.json({ authKey });
  } catch (err) {
    console.error("[checkout] AuthKey creation failed", err);
    return NextResponse.json(
      { error: "Payment session could not be created" },
      { status: 502 }
    );
  }
}
