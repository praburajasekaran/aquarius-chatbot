import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { retrieveTransaction } from "@/lib/bpoint";
import { redis } from "@/lib/kv";
import { handleConfirmedPayment } from "@/lib/payments/handleConfirmedPayment";

// Mirror the confirm-route dedup TTL (7 days) — same key namespace,
// whichever path wins the SETNX owns the fan-out.
const DEDUPE_TTL_SECONDS = 60 * 60 * 24 * 7;

/**
 * POST /api/webhooks/bpoint?ResultKey=<uuid>
 *
 * BPoint server-to-server callback. Safety net for when the browser
 * redirect to /api/checkout/confirm never lands (user closed tab,
 * flaky network). Structurally a mirror of the confirm route minus
 * browser redirects:
 *
 *   1. Read ResultKey from query (defensive on casing).
 *   2. If missing — log info + return 200 (WEBH-04).
 *   3. retrieveTransaction(ResultKey).
 *   4. Dual verification: APIResponse.ResponseCode === 0 AND TxnResp.Approved === true.
 *   5. SETNX dedup on bpoint-txn:{TxnNumber} (shared namespace with confirm route).
 *   6. handleConfirmedPayment fan-out, wrapped in try/catch.
 *   7. ALWAYS return 200 {received:true} — BPoint treats non-2xx as retry signal.
 *
 * Authentication model: trust-via-retrieveTransaction only (locked decision,
 * 03-CONTEXT.md). BPoint v2 callbacks are unsigned; a forged POST can't lie
 * about Approved because we re-verify against BPoint on every callback.
 *
 * Logging tag: [bpoint-webhook]
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const params = new URL(req.url).searchParams;
  const resultKey = params.get("ResultKey") ?? params.get("resultkey");

  if (!resultKey) {
    console.info("[bpoint-webhook] missing ResultKey — no-op", {
      url: req.url,
    });
    return NextResponse.json({ received: true });
  }

  let txn: Awaited<ReturnType<typeof retrieveTransaction>>;
  try {
    txn = await retrieveTransaction(resultKey);
  } catch (err) {
    console.error("[bpoint-webhook] retrieveTransaction threw", {
      tag: "[bpoint-webhook]",
      phase: "retrieve",
      resultKey,
      err: {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json({ received: true }); // WEBH-04
  }

  const apiOk = txn.APIResponse?.ResponseCode === 0;
  const approved = apiOk && txn.TxnResp?.Approved === true;

  if (!approved || !txn.TxnResp) {
    console.info("[bpoint-webhook] payment not approved — no-op", {
      apiResponseCode: txn.APIResponse?.ResponseCode ?? null,
      approved: txn.TxnResp?.Approved ?? null,
      bankCode: txn.TxnResp?.BankResponseCode ?? null,
    });
    return NextResponse.json({ received: true });
  }

  const { TxnNumber, Crn1: sessionId, Amount: amountCents } = txn.TxnResp;

  const dedupeKey = `bpoint-txn:${TxnNumber}`;
  const created = await redis.set(dedupeKey, "pending", {
    nx: true,
    ex: DEDUPE_TTL_SECONDS,
  });

  if (created !== "OK") {
    console.info("[bpoint-webhook] duplicate ignored (confirm route already ran)", {
      bpointTxnNumber: TxnNumber,
      sessionId,
    });
    return NextResponse.json({ received: true });
  }

  try {
    await handleConfirmedPayment({
      sessionId,
      bpointTxnNumber: TxnNumber,
      amountCents,
    });
  } catch (err) {
    console.error("[bpoint-webhook] fan-out failed", {
      tag: "[bpoint-webhook]",
      phase: "fan-out",
      bpointTxnNumber: TxnNumber,
      sessionId,
      err: {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
      timestamp: new Date().toISOString(),
    });
  }

  return NextResponse.json({ received: true }); // WEBH-04
}
