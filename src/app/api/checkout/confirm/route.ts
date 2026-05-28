import { NextResponse } from "next/server";
import { retrieveTransaction, type BPointTxnResponse } from "@/lib/bpoint";
import { redis } from "@/lib/kv";
import { bucketBankCode } from "@/lib/payments/bucket-bank-code";
import { handleConfirmedPayment } from "@/lib/payments/handleConfirmedPayment";
import { sendFirmIntegrationAlertEmail } from "@/lib/resend";

const DEDUPE_TTL_SECONDS = 60 * 60 * 24 * 7;

function resultFallbackKey(resultKey: string): string {
  return `bpoint-result:${resultKey}`;
}

function browserReturnOrigin(req: Request): string {
  const requestUrl = new URL(req.url);
  const returnTo = requestUrl.searchParams.get("returnTo");
  if (!returnTo) return requestUrl.origin;
  try {
    const url = new URL(returnTo);
    if (url.protocol === "https:") return url.origin;
    if (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    ) {
      return url.origin;
    }
  } catch {
    return requestUrl.origin;
  }
  return requestUrl.origin;
}

function failedRedirect(req: Request, reason: "declined" | "invalid" | "system" | "expired") {
  return NextResponse.redirect(
    `${browserReturnOrigin(req)}/?payment=failed&reason=${reason}`
  );
}

function successRedirect(req: Request) {
  return NextResponse.redirect(`${browserReturnOrigin(req)}/?payment=success`);
}

function isApprovedTransaction(txn: BPointTxnResponse): boolean {
  if (String(txn.APIResponse?.ResponseCode) !== "0" || !txn.TxnResp) return false;
  if (typeof txn.TxnResp.Approved === "boolean") return txn.TxnResp.Approved;
  return (
    String(txn.TxnResp.ResponseCode) === "0" ||
    txn.TxnResp.ResponseText?.toLowerCase() === "approved"
  );
}

export async function GET(req: Request): Promise<NextResponse> {
  const params = new URL(req.url).searchParams;
  const resultKey = params.get("ResultKey") ?? params.get("resultkey");
  const urlResponseCode = params.get("ResponseCode");

  if (!resultKey || (urlResponseCode && urlResponseCode !== "0")) {
    return failedRedirect(req, urlResponseCode ? "declined" : "expired");
  }

  let txn;
  try {
    txn = await retrieveTransaction(resultKey);
  } catch (err) {
    console.error("[bpoint-confirm] retrieveTransaction threw", {
      resultKey,
      err: err instanceof Error ? err.message : String(err),
    });
    return failedRedirect(req, "system");
  }

  if (!isApprovedTransaction(txn) || !txn.TxnResp) {
    const fallbackTxn = await redis.get<BPointTxnResponse>(
      resultFallbackKey(resultKey)
    );
    if (fallbackTxn && isApprovedTransaction(fallbackTxn) && fallbackTxn.TxnResp) {
      txn = fallbackTxn;
    }
  }

  if (!isApprovedTransaction(txn) || !txn.TxnResp) {
    return failedRedirect(req, bucketBankCode(txn.TxnResp?.BankResponseCode));
  }

  const dedupeKey = `bpoint-txn:${txn.TxnResp.TxnNumber}`;
  const created = await redis.set(dedupeKey, "pending", {
    nx: true,
    ex: DEDUPE_TTL_SECONDS,
  });

  if (created !== "OK") {
    return successRedirect(req);
  }

  try {
    await handleConfirmedPayment({
      sessionId: txn.TxnResp.Crn1,
      bpointTxnNumber: txn.TxnResp.TxnNumber,
      amountCents: txn.TxnResp.Amount,
    });
  } catch (err) {
    console.error("[bpoint-confirm] paid fan-out failed", {
      bpointTxnNumber: txn.TxnResp.TxnNumber,
      err: err instanceof Error ? err.message : String(err),
    });
    try {
      await sendFirmIntegrationAlertEmail({
        title: "Paid BPoint transaction needs manual follow-up",
        reason:
          err instanceof Error
            ? err.message
            : "The payment was approved, but the chatbot could not create the paid intake fan-out.",
        sessionId: txn.TxnResp.Crn1,
        details: {
          "BPoint transaction": txn.TxnResp.TxnNumber,
          "Amount cents": txn.TxnResp.Amount,
          "Bank response": txn.TxnResp.BankResponseCode,
          "BPoint response": txn.TxnResp.ResponseText,
        },
      });
    } catch (alertErr) {
      console.error("[bpoint-confirm] paid fan-out firm alert failed", {
        event: "bpoint_paid_fanout_alert_failed",
        sessionId: txn.TxnResp.Crn1,
        err: alertErr instanceof Error ? alertErr.message : String(alertErr),
      });
    }
  }

  return successRedirect(req);
}
