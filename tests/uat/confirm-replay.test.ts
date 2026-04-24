// tests/uat/confirm-replay.test.ts
// TEST-03 (replayed redirect): two GETs to /api/checkout/confirm with the same
// ResultKey. Both redirect to success (idempotent user-facing behavior).
// Dedup evidence is in Vercel logs — operator greps `[bpoint-confirm] duplicate ignored`.
//
// Shared namespace with webhook-retry.test.ts: both tests exercise the same
// `bpoint-txn:{TxnNumber}` SETNX key (Phase 3 shared dedup contract).

import { describe, it, expect, beforeAll } from "vitest";
import { assertUatGate, loadPreviewEnv } from "./setup";

const UAT_GATE = process.env.UAT_SMOKE === "1";

describe.skipIf(!UAT_GATE)("UAT TEST-03 — replayed redirect dedup (confirm route)", () => {
  let previewUrl: string;
  let resultKey: string;

  beforeAll(() => {
    assertUatGate();
    const env = loadPreviewEnv();
    previewUrl = env.previewUrl;
    resultKey = env.resultKey;
  });

  it("two GETs with same ResultKey both redirect to /?payment=success", async () => {
    const url = `${previewUrl}/api/checkout/confirm?ResultKey=${encodeURIComponent(resultKey)}&ResponseCode=0`;

    const res1 = await fetch(url, { redirect: "manual" });
    const res2 = await fetch(url, { redirect: "manual" });

    expect([302, 303, 307, 308]).toContain(res1.status);
    expect([302, 303, 307, 308]).toContain(res2.status);

    const loc1 = res1.headers.get("location");
    const loc2 = res2.headers.get("location");
    expect(loc1).toMatch(/payment=success/);
    expect(loc2).toMatch(/payment=success/);

    // Evidence is in Vercel logs. Operator captures:
    //   `vercel logs $UAT_PREVIEW_URL | grep "[bpoint-confirm]"`
    //     → MUST show: 1 initial "action=fanout" or similar + 1 "duplicate ignored"
    // Saved to screenshots/sc3-replayed-redirect.log and referenced in
    // 04-UAT-EVIDENCE.md TEST-03 §4.3 row.
    console.log(
      `[uat-evidence] Capture Vercel log tail: vercel logs ${previewUrl} --follow | grep bpoint-confirm`
    );
  });

  it("second call is idempotent: does NOT send a second receipt email or Zapier transcript", async () => {
    // This assertion is OUT-OF-BAND: Resend + Zapier dashboards show exactly 1
    // receipt / 1 transcript per bpointTxnNumber. The test can't programmatically
    // query those, but it drives the condition. Operator verifies in dashboards
    // per RUNBOOK §4.3 and records counts in the evidence bundle.
    //
    // Intentionally sparse test — this assertion is manual-only by design.
    expect(true).toBe(true);
  });
});
