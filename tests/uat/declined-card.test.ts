// tests/uat/declined-card.test.ts
// TEST-03 (declined card): retrieveTransaction on a ResultKey from a txn
// submitted with magic expiry 99/05 (doNotHonour) returns:
//   - APIResponse.ResponseCode === 0 (API call succeeded — txn was retrievable)
//   - TxnResp.Approved === false (dual-verification: declined)
//   - TxnResp.BankResponseCode === "05" (confirms magic-expiry rule worked)
//
// The UI-level "declined bucket" assertion is manual (RUNBOOK §4.1 screenshot).
// This test proves the retrieveTransaction response shape + confirms the magic
// expiry convention still works.

import { describe, it, expect, beforeAll } from "vitest";
import { retrieveTransaction } from "@/lib/bpoint";
import { assertUatGate } from "./setup";
import { MAGIC_EXPIRY } from "./fixtures/test-pans";

const UAT_GATE = process.env.UAT_SMOKE === "1";

describe.skipIf(!UAT_GATE)("UAT TEST-03 — declined card response shape", () => {
  let declinedResultKey: string;

  beforeAll(() => {
    assertUatGate();
    declinedResultKey = process.env.UAT_DECLINED_RESULT_KEY ?? "";
    if (!declinedResultKey) {
      throw new Error(
        `[uat-guard] UAT_DECLINED_RESULT_KEY not set — run RUNBOOK §4.1 ` +
        `(iframe with expiry ${MAGIC_EXPIRY.doNotHonour}) and capture the ` +
        `ResultKey from Vercel logs`
      );
    }
  });

  it("retrieveTransaction returns TxnResp.Approved === false", async () => {
    const txn = await retrieveTransaction(declinedResultKey);

    // API call itself succeeded (transaction IS retrievable — it's a valid
    // declined txn, not a missing one).
    expect(txn.APIResponse.ResponseCode).toBe(0);

    // But dual-verification flips to false — Approved MUST be false.
    expect(txn.TxnResp).toBeDefined();
    expect(txn.TxnResp!.Approved).toBe(false);
  });

  it("BankResponseCode is '05' (do-not-honour per magic expiry 99/05)", async () => {
    const txn = await retrieveTransaction(declinedResultKey);
    expect(txn.TxnResp).toBeDefined();
    expect(txn.TxnResp!.BankResponseCode).toBe("05");
  });

  it("declined response round-trips integer-cents Amount correctly", async () => {
    const txn = await retrieveTransaction(declinedResultKey);
    if (!txn.TxnResp) return;

    // Amount is still one of the PRICING values — DO NOT change amount for
    // testing (Pitfall 3). Magic expiry `99/05` preserves amount.
    expect(Number.isInteger(txn.TxnResp.Amount)).toBe(true);
    expect([132000, 72600]).toContain(txn.TxnResp.Amount);
  });
});
