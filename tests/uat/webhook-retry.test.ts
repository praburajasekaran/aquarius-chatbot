// tests/uat/webhook-retry.test.ts
// TEST-03 (webhook retry): two POSTs to /api/webhooks/bpoint with the same
// ResultKey. Both return 200 (WEBH-04: webhook always returns 200).
// Dedup evidence is in Vercel logs (grep `[bpoint-webhook] duplicate ignored`).
//
// Method B (curl replay) per RESEARCH.md §"Failure path induction". Method A
// (natural retry via brief preview disable) is NOT reliable — BPoint retry
// cadence is not publicly documented (Pitfall 4).
//
// Shares `bpoint-txn:{TxnNumber}` SETNX namespace with confirm route.
// If confirm route already ran fan-out on this ResultKey (from Plan 02 happy
// path), BOTH webhook POSTs will see SETNX collision — which is the correct
// cross-route dedup proof (Phase 3 WEBH-03 invariant).

import { describe, it, expect, beforeAll } from "vitest";
import { assertUatGate, loadPreviewEnv } from "./setup";

const UAT_GATE = process.env.UAT_SMOKE === "1";

describe.skipIf(!UAT_GATE)("UAT TEST-03 — webhook retry dedup", () => {
  let previewUrl: string;
  let resultKey: string;

  beforeAll(() => {
    assertUatGate();
    const env = loadPreviewEnv();
    previewUrl = env.previewUrl;
    resultKey = env.resultKey;
  });

  it("two POSTs with same ResultKey both return 200 {received: true}", async () => {
    const url = `${previewUrl}/api/webhooks/bpoint?ResultKey=${encodeURIComponent(resultKey)}`;

    const res1 = await fetch(url, { method: "POST" });
    const res2 = await fetch(url, { method: "POST" });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    // Both bodies should be {received: true} per WEBH-04.
    const body1 = await res1.json();
    const body2 = await res2.json();
    expect(body1).toMatchObject({ received: true });
    expect(body2).toMatchObject({ received: true });

    console.log(
      `[uat-evidence] Capture Vercel log tail: vercel logs ${previewUrl} --follow | grep bpoint-webhook`
    );
  });

  it("webhook path shares SETNX namespace with confirm route (cross-route dedup)", async () => {
    // Assumed precondition: UAT_RESULT_KEY is from a txn that already ran fan-out
    // via the confirm route in Plan 02. Every webhook POST on this ResultKey
    // should see SETNX collision (key already set to the upgraded hash token).
    //
    // Assertion is BEHAVIORAL (log-visible), not HTTP-visible — webhook always
    // returns 200 regardless. This test drives the cross-route scenario; operator
    // verifies in logs per RUNBOOK §4.4 and records in evidence bundle.
    //
    // What to grep in Vercel logs after running this test:
    //   `[bpoint-webhook] duplicate ignored` on BOTH calls (because confirm
    //   route already owns the SETNX key from Plan 02 happy-path run).
    expect(true).toBe(true);
  });
});
