// tests/uat/happy-path.test.ts
// TEST-01: End-to-end happy-path assertion against the live Vercel preview.
//
// Prerequisite: Operator has completed RUNBOOK §3 (iframe card entry) and
// captured UAT_RESULT_KEY from the resulting Vercel log line.
//
// What this proves:
// - Confirm route processed the same ResultKey successfully (redirect = /?payment=success)
// - retrieveTransaction independently confirms the txn is approved + amount matches PRICING
// - The round-trip (iframe → BPoint UAT → redirect → confirm route → retrieve) is wired
//
// Not scripted:
// - Iframe card entry (see RUNBOOK §3)
// - Receipt email delivery (operator screenshots)
// - Zapier transcript delivery (operator checks Zapier dashboard)

import { describe, it, expect, beforeAll } from "vitest";
import { retrieveTransaction } from "@/lib/bpoint";
import { PRICING } from "@/lib/pricing";
import { assertUatGate, loadPreviewEnv } from "./setup";

const UAT_GATE = process.env.UAT_SMOKE === "1";

describe.skipIf(!UAT_GATE)(
  "UAT happy path — confirm route round-trip (TEST-01)",
  () => {
    let previewUrl: string;
    let resultKey: string;

    beforeAll(() => {
      assertUatGate();
      const env = loadPreviewEnv();
      previewUrl = env.previewUrl;
      resultKey = env.resultKey;
    });

    it("GET /api/checkout/confirm?ResultKey=<rk>&ResponseCode=0 redirects to /?payment=success", async () => {
      const url = `${previewUrl}/api/checkout/confirm?ResultKey=${encodeURIComponent(resultKey)}&ResponseCode=0`;
      const res = await fetch(url, { redirect: "manual" });

      // Expect 307 (or 302/303/308) redirect. The confirm route always redirects,
      // even on dedup collision (idempotent success redirect per Phase 2 decision).
      expect([302, 303, 307, 308]).toContain(res.status);

      const location = res.headers.get("location");
      expect(location).toBeTruthy();
      expect(location).toMatch(/payment=success/);
    });

    it("retrieveTransaction cross-check: txn is Approved + Amount matches PRICING", async () => {
      const txn = await retrieveTransaction(resultKey);

      expect(txn.APIResponse.ResponseCode).toBe(0);
      expect(txn.TxnResp).toBeDefined();
      expect(txn.TxnResp).not.toBeNull();
      expect(txn.TxnResp!.Approved).toBe(true);

      const validAmounts = [
        PRICING.urgent.amount, // 132000
        PRICING["non-urgent"].amount, // 72600
      ];
      expect(validAmounts).toContain(txn.TxnResp!.Amount);
    });

    it("confirm route is idempotent: second identical call still redirects to success (SETNX collision OK)", async () => {
      // This is a soft TEST-01 check (hard version is in Plan 03 confirm-replay).
      // The second call MUST still return the success redirect (user-facing behavior
      // is unchanged regardless of dedup), even though fan-out is skipped.
      const url = `${previewUrl}/api/checkout/confirm?ResultKey=${encodeURIComponent(resultKey)}&ResponseCode=0`;

      const res1 = await fetch(url, { redirect: "manual" });
      const res2 = await fetch(url, { redirect: "manual" });

      expect([302, 303, 307, 308]).toContain(res1.status);
      expect([302, 303, 307, 308]).toContain(res2.status);
      expect(res1.headers.get("location")).toMatch(/payment=success/);
      expect(res2.headers.get("location")).toMatch(/payment=success/);
    });
  }
);
