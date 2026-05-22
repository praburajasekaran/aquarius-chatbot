// tests/uat/retrieve-transaction.test.ts
// Live smoke test: retrieveTransaction against BPoint UAT.
// GATE: UAT_SMOKE=1 + UAT_RESULT_KEY set. See tests/uat/README.md.
//
// What this proves (TEST-01 requirement):
// - retrieveTransaction called with a real UAT ResultKey returns a well-typed
//   BPointTxnResponse (matches the type we use in src/app/api/checkout/confirm/route.ts)
// - APIResponse.ResponseCode is numeric (not string) — Phase 2 CONF-03 contract
// - If the txn was approved, TxnResp.Approved === true + Amount is integer cents
//   matching PRICING[urgency].amount
// - If present on the wire, MerchantReference equals PRICING[urgency].lineItem
//   (TEST-02 prerequisite check — surfaces Pitfall 5 truncation early)
//
// Not scripted (manual per RUNBOOK §3):
// - Iframe card entry (cross-origin, BPoint forbids automation per RESEARCH.md)
// - Receipt email delivery (asserted visually by operator — screenshot)

import { describe, it, expect, beforeAll } from "vitest";
import { retrieveTransaction } from "@/lib/bpoint";
import { PRICING } from "@/lib/pricing";
import { assertUatGate, loadPreviewEnv } from "./setup";

const UAT_GATE = process.env.UAT_SMOKE === "1";

describe.skipIf(!UAT_GATE)(
  "BPoint UAT — retrieveTransaction live smoke (TEST-01)",
  () => {
    let resultKey: string;

    beforeAll(() => {
      assertUatGate();
      const env = loadPreviewEnv();
      resultKey = env.resultKey;
      if (!process.env.BPOINT_API_USERNAME) {
        throw new Error(
          "[uat-guard] BPOINT_API_USERNAME not set — run `vercel env pull` first"
        );
      }
    });

    it("returns a well-typed BPointTxnResponse with numeric ResponseCode", async () => {
      const txn = await retrieveTransaction(resultKey);

      expect(txn).toBeDefined();
      expect(txn.APIResponse).toBeDefined();
      expect(typeof txn.APIResponse.ResponseCode).toBe("number");
      expect(typeof txn.APIResponse.ResponseText).toBe("string");
    });

    it("if approved: TxnResp.Approved is true and Amount matches PRICING", async () => {
      const txn = await retrieveTransaction(resultKey);

      // This UAT_RESULT_KEY is captured from a successful happy-path run by the
      // operator (see RUNBOOK §3). If the operator set it from a declined run,
      // this assertion will fail — which is the correct signal (wrong key fixture).
      if (txn.APIResponse.ResponseCode !== 0) {
        throw new Error(
          `[uat-guard] UAT_RESULT_KEY points to a non-approved txn ` +
            `(APIResponse.ResponseCode=${txn.APIResponse.ResponseCode} ` +
            `"${txn.APIResponse.ResponseText}"). Re-run RUNBOOK §3 happy-path and ` +
            `capture the ResultKey from the approved transaction.`
        );
      }

      expect(txn.TxnResp).toBeDefined();
      expect(txn.TxnResp).not.toBeNull();
      expect(txn.TxnResp!.Approved).toBe(true);
      expect(Number.isInteger(txn.TxnResp!.Amount)).toBe(true);

      // Amount must be one of the two PRICING values
      const validAmounts = [
        PRICING.urgent.amount, // 132000
        PRICING["non-urgent"].amount, // 72600
      ];
      expect(validAmounts).toContain(txn.TxnResp!.Amount);
    });

    it("MerchantReference byte-matches PRICING[urgency].lineItem (TEST-02 prereq)", async () => {
      const txn = await retrieveTransaction(resultKey);
      if (txn.APIResponse.ResponseCode !== 0 || !txn.TxnResp) return;

      const validLineItems = [
        PRICING.urgent.lineItem, // "Initial Deposit for Urgent Court Matter"
        PRICING["non-urgent"].lineItem, // "Legal Strategy Session"
      ];

      // MerchantReference is not on the TypeScript BPointTxnResp interface
      // (src/lib/bpoint.ts intentionally narrows to fields the confirm route
      // consumes). BPoint MAY surface it on the wire — probe at runtime. This
      // is the upstream guard for TEST-02 (Smokeball reconciliation): if BPoint
      // truncates/omits the field, Smokeball invoice line reconciliation could
      // only be explained by a Smokeball-side issue rather than a BPoint one.
      const merchantReference = (txn.TxnResp as unknown as {
        MerchantReference?: string;
      }).MerchantReference;

      if (merchantReference) {
        expect(validLineItems).toContain(merchantReference);
      } else {
        // Pitfall 5 (RESEARCH.md): truncation/omission at BPoint. Surface as
        // warning so TEST-02 investigation narrows to the downstream hop.
        console.warn(
          "[uat-warning] retrieveTransaction did not return MerchantReference — " +
            "verify BPoint is preserving the field through the retrieve API. See Pitfall 5."
        );
      }
    });

    it("BankResponseCode is '00' (approved) on the happy-path fixture ResultKey", async () => {
      const txn = await retrieveTransaction(resultKey);
      if (txn.APIResponse.ResponseCode !== 0 || !txn.TxnResp) return;

      expect(txn.TxnResp.BankResponseCode).toBe("00");
    });
  }
);
