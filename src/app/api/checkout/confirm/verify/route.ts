import { NextResponse } from "next/server";
import { consumePaymentProof } from "@/lib/payment-proof";

function response(body: { confirmed: boolean }, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
    },
  });
}

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const proof = url.searchParams.get("proof") ?? "";
  const sessionId = url.searchParams.get("sessionId") ?? "";
  if (!proof || !sessionId) return response({ confirmed: false }, 400);

  try {
    return response({
      confirmed: await consumePaymentProof(proof, sessionId),
    });
  } catch (err) {
    console.error("[bpoint-confirm] payment proof verification failed", {
      event: "bpoint_payment_proof_verification_failed",
      err: err instanceof Error ? err.message : String(err),
    });
    return response({ confirmed: false }, 503);
  }
}
