export type FailureBucket = "declined" | "invalid" | "system";

const DECLINED_CODES = new Set(["05", "51", "54", "57", "61", "62", "65", "91"]);
const INVALID_CODES = new Set(["14", "55", "82", "N7"]);

export function bucketBankCode(code: string | undefined): FailureBucket {
  if (!code) return "system";
  if (DECLINED_CODES.has(code)) return "declined";
  if (INVALID_CODES.has(code)) return "invalid";
  return "system";
}
