/**
 * Maps a BPoint TxnResp.BankResponseCode (ISO 8583 + BPoint extensions) to
 * one of three user-facing failure buckets.
 *
 * The raw BankResponseCode MUST NOT be shown in the UI (locked decision in
 * 02-CONTEXT.md — it stays in server logs only, correlated by
 * bpointTxnNumber).
 *
 * Source mapping: 02-RESEARCH.md Pattern 6.
 * - "declined": card-level decline (issuer says no — try another card)
 * - "invalid":  format-level rejection (CVV/PAN/expiry is wrong)
 * - "system":   network/system/unknown — default for any unmatched code
 */
export type FailureBucket = "declined" | "invalid" | "system";

const DECLINED_CODES = new Set([
  "05", // Do not honour
  "51", // Insufficient funds
  "54", // Expired card
  "57", // Transaction not permitted
  "61", // Exceeds withdrawal limit
  "62", // Restricted card
  "65", // Exceeds withdrawal frequency limit
  "91", // Issuer unavailable — treated as declined retry
]);

const INVALID_CODES = new Set([
  "14", // Invalid card number
  "55", // Incorrect PIN
  "82", // CVV2 failed
  "N7", // CVV2 mismatch
]);

export function bucketBankCode(code: string): FailureBucket {
  if (DECLINED_CODES.has(code)) return "declined";
  if (INVALID_CODES.has(code)) return "invalid";
  return "system";
}
