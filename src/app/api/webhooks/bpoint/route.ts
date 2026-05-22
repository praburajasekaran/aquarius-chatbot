import { NextResponse } from "next/server";
import { retrieveTransaction, type BPointTxnResponse } from "@/lib/bpoint";
import { redis } from "@/lib/kv";
import { handleConfirmedPayment } from "@/lib/payments/handleConfirmedPayment";

const DEDUPE_TTL_SECONDS = 60 * 60 * 24 * 7;

function isApprovedTransaction(txn: BPointTxnResponse): boolean {
  if (String(txn.APIResponse?.ResponseCode) !== "0" || !txn.TxnResp) return false;
  if (typeof txn.TxnResp.Approved === "boolean") return txn.TxnResp.Approved;
  return (
    String(txn.TxnResp.ResponseCode) === "0" ||
    txn.TxnResp.ResponseText?.toLowerCase() === "approved"
  );
}

async function readResultKey(req: Request): Promise<string | null> {
  const url = new URL(req.url);
  const fromQuery =
    url.searchParams.get("ResultKey") ?? url.searchParams.get("resultkey");
  if (fromQuery) return fromQuery;

  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await req.json().catch(() => null)) as
      | { ResultKey?: unknown; resultkey?: unknown }
      | null;
    const value = body?.ResultKey ?? body?.resultkey;
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  const text = await req.text().catch(() => "");
  if (!text) return null;
  const params = new URLSearchParams(text);
  return params.get("ResultKey") ?? params.get("resultkey");
}

export async function POST(req: Request): Promise<NextResponse> {
  const resultKey = await readResultKey(req);
  if (!resultKey) return NextResponse.json({ received: true });

  let txn;
  try {
    txn = await retrieveTransaction(resultKey);
  } catch (err) {
    console.error("[bpoint-webhook] retrieveTransaction threw", {
      resultKey,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ received: true });
  }

  if (!isApprovedTransaction(txn) || !txn.TxnResp) {
    return NextResponse.json({ received: true });
  }

  const dedupeKey = `bpoint-txn:${txn.TxnResp.TxnNumber}`;
  const created = await redis.set(dedupeKey, "pending", {
    nx: true,
    ex: DEDUPE_TTL_SECONDS,
  });
  if (created !== "OK") return NextResponse.json({ received: true });

  try {
    await handleConfirmedPayment({
      sessionId: txn.TxnResp.Crn1,
      bpointTxnNumber: txn.TxnResp.TxnNumber,
      amountCents: txn.TxnResp.Amount,
    });
  } catch (err) {
    console.error("[bpoint-webhook] paid fan-out failed", {
      bpointTxnNumber: txn.TxnResp.TxnNumber,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.json({ received: true });
}
