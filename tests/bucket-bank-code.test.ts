import { describe, it, expect } from "vitest";
import { bucketBankCode } from "@/lib/payments/bucket-bank-code";

describe("bucketBankCode", () => {
  it.each([
    ["05", "declined"],
    ["51", "declined"],
    ["54", "declined"],
    ["57", "declined"],
    ["61", "declined"],
    ["62", "declined"],
    ["65", "declined"],
    ["91", "declined"],
    ["14", "invalid"],
    ["55", "invalid"],
    ["82", "invalid"],
    ["N7", "invalid"],
    ["96", "system"],
    ["99", "system"],
    ["", "system"],
  ])("maps %s to %s", (code, bucket) => {
    expect(bucketBankCode(code)).toBe(bucket);
  });
});
