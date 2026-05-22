---
phase: 02-confirmation-ui
plan: 03
subsystem: payments
tags: [bpoint, next-app-router, redis, setnx, redirect, confirm-route]

requires:
  - phase: 02-confirmation-ui
    provides: retrieveTransaction, bucketBankCode, handleConfirmedPayment, redis SETNX dedup
provides:
  - GET /api/checkout/confirm route (BPoint iframe landing handler)
  - Dual verification gate (APIResponse.ResponseCode === 0 AND TxnResp.Approved === true)
  - Redis SETNX dedup on bpoint-txn:{TxnNumber} (pending placeholder, 7-day TTL)
  - Fan-out call to handleConfirmedPayment wrapped so fan-out failures never 5xx
  - Defensive ResultKey/resultkey casing parse (browser-forgeable URL contract)
affects: [02-04-chat-ui-bpoint-iframe, 03-bpoint-webhook, 04-uat]

tech-stack:
  added: []
  patterns:
    - "Browser-visible URL parameters treated as untrusted — always re-verify via retrieveTransaction"
    - "SETNX with TTL BEFORE any side effect — Upstash `redis.set(key, val, { nx: true, ex: N })` returns 'OK' | null"
    - "Fan-out try/catch isolation — payment already captured by BPoint, user gets success redirect even on downstream failure"
    - "NextResponse.redirect requires absolute URL — appUrl() helper reads NEXT_PUBLIC_URL || APP_URL"

key-files:
  created:
    - src/app/api/checkout/confirm/route.ts
  modified: []

key-decisions:
  - "URL params treated as hints only — server-side retrieveTransaction is the authoritative source"
  - "Defensive ResultKey/resultkey casing parse — resolves 02-RESEARCH.md Open Question 2"
  - "Fan-out errors logged with bpointTxnNumber but produce success redirect — payment is real, support reconciles from logs"
  - "DEDUPE_TTL_SECONDS = 7 days — matches stripe-session:* TTL in 02-CONTEXT.md fan-out trigger boundary"

patterns-established:
  - "Pattern: Dual verification gate — apiOk = APIResponse.ResponseCode === 0, approved = apiOk && TxnResp.Approved === true"
  - "Pattern: Logging tag `[bpoint-confirm]` on every early-exit and error path for support-team log grepping"

requirements-completed: [CONF-01, CONF-02, CONF-03, CONF-04, CONF-05]

duration: ~12min
completed: 2026-04-24
---

# Phase 2 Plan 03: BPoint Confirm Route Summary

**GET /api/checkout/confirm landing handler: dual-verification gate (APIResponse.ResponseCode === 0 AND TxnResp.Approved) with Redis SETNX dedup before fan-out; produces 3xx redirects on every path (no 5xx surfaced to browser).**

## Performance

- **Duration:** ~12 min (includes human-verify smoke test pause)
- **Tasks:** 2 (1 auto TDD + 1 human-verify checkpoint)
- **Files created:** 1 (src/app/api/checkout/confirm/route.ts, 131 lines)
- **Files modified:** 0

## Accomplishments

- GET /api/checkout/confirm route implemented with all 8 confirm-route unit tests GREEN
- Dual verification gate: both URL ResponseCode=0 AND server-side APIResponse.ResponseCode === 0 AND TxnResp.Approved === true required before fan-out
- Redis SETNX dedup on `bpoint-txn:{TxnNumber}` with 7-day TTL — collision skips fan-out and redirects to success (idempotent replay handling, CONF-05)
- Fan-out wrapped in try/catch — handleConfirmedPayment exceptions logged with bpointTxnNumber but user still receives success redirect (never 5xx surfaced)
- Defensive `ResultKey` / `resultkey` casing handled (closes 02-RESEARCH.md Open Question 2)
- Four-probe manual smoke test against live dev server confirmed 307 redirects with correct Location query params

## Task Commits

1. **Task 1: Create src/app/api/checkout/confirm/route.ts** — `8fb6bfc` (feat)
2. **Task 2: Manual smoke test** — no commit (checkpoint verification only)

**Plan metadata:** (this commit) — `docs(02-03): complete confirm route plan`

## Files Created/Modified

- `src/app/api/checkout/confirm/route.ts` — GET handler: parse ResultKey/ResponseCode → early-exit on missing/non-zero → retrieveTransaction → dual-verification gate → SETNX dedup → fan-out → success/failure redirect. Logging tag `[bpoint-confirm]`.

## Decisions Made

- **URL params are hints, server is truth:** URL ResponseCode used only for early-exit optimisation; the authoritative answer always comes from `retrieveTransaction`.
- **DEDUPE_TTL_SECONDS = 7 days:** Matches `stripe-session:*` TTL boundary per 02-CONTEXT.md — covers BPoint reconciliation window.
- **Fan-out isolation:** Exceptions from `handleConfirmedPayment` are caught and logged with `bpointTxnNumber` but the user still gets `?payment=success`. Rationale: payment is real (BPoint captured it); support reconciles from logs rather than showing user a failure for already-captured money.
- **Defensive casing:** `params.get("ResultKey") ?? params.get("resultkey")` — BPoint's docs are ambiguous about casing; defensive read costs nothing.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

**Smoke test — cosmetic Location host mismatch (non-blocking):**
- During manual verification, curl probes against `http://localhost:3001` returned 307 redirects with `Location: http://localhost:3000/?payment=failed&reason=...`.
- Root cause: a stale Next.js dev-server process was squatting on port 3000, so NEXT_PUBLIC_URL resolved to :3000 while the test server ran on :3001.
- Route logic is fully correct — the Location query params (`?payment=failed&reason=declined`, `&reason=system`) match plan expectations on all four probes.
- No action required; operator confirmed "approved".

**Smoke test results (all PASSED):**

| Probe | Status | Location |
|-------|--------|----------|
| Missing ResultKey | 307 | /?payment=failed&reason=declined |
| ResponseCode=99 | 307 | /?payment=failed&reason=declined |
| Lowercase resultkey | 307 | /?payment=failed&reason=declined |
| Bogus ResultKey + ResponseCode=0 | 307 | /?payment=failed&reason=system |

## User Setup Required

None — no external service configuration introduced by this plan. BPoint UAT credentials (already a known Phase 1 blocker) will be needed for end-to-end confirm-route testing in Phase 4 UAT, but this plan's unit + smoke-test surface did not require them.

## Next Phase Readiness

- All five CONF-* requirements (CONF-01, CONF-02, CONF-03, CONF-04, CONF-05) complete.
- Plan 02-04 (chat-widget BPoint iframe swap + URL-param signal) unblocked — confirm route is the redirect destination the chat-widget will reconcile via `?payment=...`.
- Phase 3 BPoint webhook will reuse the SAME `handleConfirmedPayment` fan-out helper and the SAME `bpoint-txn:{TxnNumber}` dedup key — confirm route establishes the dedup-key convention the webhook must match.

## Self-Check: PASSED

- src/app/api/checkout/confirm/route.ts: FOUND (131 lines, `export async function GET` present)
- Commit 8fb6bfc: FOUND in git log (feat(02-03): add GET /api/checkout/confirm route)
- All 8 confirm-route tests: GREEN (verified in Task 1 by previous agent)
- Smoke test: operator-approved (four probes returned expected 307 redirects)

---
*Phase: 02-confirmation-ui*
*Completed: 2026-04-24*
