import { NextResponse } from "next/server";
import { z } from "zod";
import {
  processIframeTransaction,
  type BPointTxnResponse,
} from "@/lib/bpoint";
import { getIntake } from "@/lib/intake";
import { redis } from "@/lib/kv";
import { parseJsonBody } from "@/lib/api/parse";

const Body = z.object({
  sessionId: z.string().min(1),
  authKey: z.string().min(1),
});
const RESULT_FALLBACK_TTL_SECONDS = 60 * 60 * 24 * 7;

function resultFallbackKey(resultKey: string): string {
  return `bpoint-result:${resultKey}`;
}

function buildApprovedFallbackTxn(
  resultKey: string,
  intake: NonNullable<Awaited<ReturnType<typeof getIntake>>>
): BPointTxnResponse {
  return {
    APIResponse: { ResponseCode: 0, ResponseText: "Success" },
    TxnResp: {
      TxnNumber: resultKey,
      Approved: true,
      Crn1: intake.sessionId,
      Amount: intake.amountCents,
      BankResponseCode: "00",
      ResponseText: "Approved",
    },
  };
}

export async function POST(req: Request): Promise<NextResponse> {
  const parsed = await parseJsonBody(req, Body);
  if (!parsed.ok) return parsed.response;
  const { sessionId, authKey } = parsed.data;

  const intake = await getIntake(sessionId);
  if (!intake) {
    return NextResponse.json({ error: "intake_not_found" }, { status: 404 });
  }
  if (intake.bpointAuthKey !== authKey) {
    return NextResponse.json({ error: "authkey_mismatch" }, { status: 409 });
  }

  let result;
  try {
    result = await processIframeTransaction({
      authKey,
      sessionId,
      urgency: intake.urgency,
      customerEmail: intake.clientEmail,
      customerName: intake.clientName,
    });
  } catch (err) {
    console.error("[checkout/process] BPoint iframe process failed", {
      event: "bpoint_iframe_process_failed",
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "process_failed" }, { status: 502 });
  }

  if (result.APIResponse.ResponseCode !== 0 && result.APIResponse.ResponseCode !== 300) {
    return NextResponse.json(
      {
        error: "bpoint_declined",
        responseCode: result.APIResponse.ResponseCode,
        responseText: result.APIResponse.ResponseText,
      },
      { status: 402 }
    );
  }

  if (result.ResultKey) {
    try {
      await redis.set(
        resultFallbackKey(result.ResultKey),
        buildApprovedFallbackTxn(result.ResultKey, intake),
        { ex: RESULT_FALLBACK_TTL_SECONDS }
      );
    } catch (err) {
      console.error("[checkout/process] failed to store BPoint result fallback", {
        event: "bpoint_result_fallback_write_failed",
        sessionId,
        resultKey: result.ResultKey,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    resultKey: result.ResultKey,
    redirectionUrl: result.RedirectionUrl,
  });
}
