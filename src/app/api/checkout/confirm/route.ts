import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { retrieveTransaction } from "@/lib/bpoint";
import { redis } from "@/lib/kv";
import { handleConfirmedPayment } from "@/lib/payments/handleConfirmedPayment";
import { bucketBankCode } from "@/lib/payments/bucket-bank-code";

// Matches bpoint-txn:* TTL — see 02-CONTEXT.md fan-out trigger boundary.
const DEDUPE_TTL_SECONDS = 60 * 60 * 24 * 7;

function appUrl(): string {
  // NEXT_PUBLIC_URL is the canonical public origin used by createAuthKey's
  // RedirectionUrl. Fall back to APP_URL (server-side) for symmetry with
  // handleConfirmedPayment's email link generation.
  return (
    process.env.NEXT_PUBLIC_URL ??
    process.env.APP_URL ??
    ""
  );
}

function failedRedirect(reason: "declined" | "invalid" | "system" | "expired"): NextResponse {
  return NextResponse.redirect(`${appUrl()}/?payment=failed&reason=${reason}`);
}

function successRedirect(): NextResponse {
  return NextResponse.redirect(`${appUrl()}/?payment=success`);
}

/**
 * GET /api/checkout/confirm?ResultKey=<uuid>&ResponseCode=<n>
 *
 * Browser landing route after the BPoint iframe submits a payment. The URL
 * params are client-visible and forgeable — the only authoritative answer
 * comes from a server-side retrieveTransaction call.
 *
 * Flow:
 *   1. Parse ResultKey + ResponseCode (defensive against missing/odd casing).
 *   2. Early-exit redirect if missing or URL ResponseCode != "0".
 *   3. retrieveTransaction(ResultKey).
 *   4. Dual verification (CONF-03): APIResponse.ResponseCode === 0 AND TxnResp.Approved === true.
 *   5. SETNX dedup on bpoint-txn:{TxnNumber} BEFORE any side effect (CONF-05).
 *   6. handleConfirmedPayment fan-out, wrapped in try/catch — fan-out errors
 *      MUST NOT cause a 5xx; the user still gets a redirect.
 *   7. Redirect to /?payment=success (or /?payment=failed&reason=...).
 *
 * Logging tag: [bpoint-confirm]
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  // Defensive read for both ResultKey casings (see 02-RESEARCH.md Open Question 2).
  // Use req.url (standard Request) rather than req.nextUrl — the route is
  // spec-compatible with both NextRequest and a plain Request, which keeps
  // the handler trivially testable via `new Request(url)`.
  const params = new URL(req.url).searchParams;
  const resultKey = params.get("ResultKey") ?? params.get("resultkey");
  const urlResponseCode = params.get("ResponseCode");

  // 1 + 2: early exit on missing or non-zero URL ResponseCode. Don't call
  // BPoint — the URL itself signals failure.
  if (!resultKey || urlResponseCode !== "0") {
    console.info("[bpoint-confirm] early-exit failed redirect", {
      hasResultKey: Boolean(resultKey),
      urlResponseCode,
    });
    return failedRedirect("declined");
  }

  // 3: server-side verification.
  let txn: Awaited<ReturnType<typeof retrieveTransaction>>;
  try {
    txn = await retrieveTransaction(resultKey);
  } catch (err) {
    console.error("[bpoint-confirm] retrieveTransaction threw", {
      resultKey,
      err: err instanceof Error ? err.message : String(err),
    });
    return failedRedirect("system");
  }

  // 4: dual verification (CONF-03).
  const apiOk = txn.APIResponse?.ResponseCode === 0;
  const approved = apiOk && txn.TxnResp?.Approved === true;

  if (!approved || !txn.TxnResp) {
    const bankCode = txn.TxnResp?.BankResponseCode ?? "";
    const reason = apiOk ? bucketBankCode(bankCode) : "system";
    console.info("[bpoint-confirm] payment not approved", {
      bpointTxnNumber: txn.TxnResp?.TxnNumber ?? null,
      apiResponseCode: txn.APIResponse?.ResponseCode ?? null,
      bankCode,
      reason,
    });
    return failedRedirect(reason);
  }

  const { TxnNumber, Crn1: sessionId, Amount: amountCents } = txn.TxnResp;

  // 5: SETNX dedup BEFORE any side effect (CONF-05). Upstash returns "OK"
  // on first set, null on collision.
  const dedupeKey = `bpoint-txn:${TxnNumber}`;
  const created = await redis.set(dedupeKey, "pending", {
    nx: true,
    ex: DEDUPE_TTL_SECONDS,
  });

  if (created !== "OK") {
    console.info("[bpoint-confirm] duplicate ignored", {
      bpointTxnNumber: TxnNumber,
    });
    return successRedirect();
  }

  // 6: fan-out — wrapped so failures don't cause a 5xx (Pitfall 4).
  try {
    await handleConfirmedPayment({
      sessionId,
      bpointTxnNumber: TxnNumber,
      amountCents,
    });
  } catch (err) {
    console.error("[bpoint-confirm] fan-out failed", {
      bpointTxnNumber: TxnNumber,
      err: err instanceof Error ? err.message : String(err),
    });
    // Do NOT redirect to failed — the payment is real and recorded by BPoint.
    // The user gets success; support reconciles via the log + bpointTxnNumber.
  }

  // 7: success redirect.
  return successRedirect();
}
