---
phase: 04-validation
plan: 03
subsystem: testing
tags: [uat, vitest, bpoint, dedup, setnx, test-03, failure-paths]

# Dependency graph
requires:
  - phase: 04-validation
    provides: "Plan 04-01 Wave 0 scaffolding (tests/uat/setup.ts, fixtures/test-pans.ts, README.md, 04-RUNBOOK.md, 04-UAT-EVIDENCE.md, screenshots/.gitkeep, UAT gate in vitest.config.mts, UAT env vars in .env.example)"
  - phase: 03-webhook-cleanup
    provides: "Webhook route returns 200 with shared bpoint-txn:{TxnNumber} SETNX namespace (WEBH-04); confirm route + webhook route share dedup namespace (cross-route SETNX contract)"
  - phase: 02-confirmation-ui
    provides: "Confirm route dual-verification (APIResponse.ResponseCode===0 AND TxnResp.Approved===true); handleConfirmedPayment fan-out via SETNX-winner; structured logs [bpoint-confirm] / [bpoint-webhook]"
  - phase: 01-foundation
    provides: "retrieveTransaction(resultKey) client with BPointTxnResponse shape; pricing.ts PRICING constants"
provides:
  - "tests/uat/confirm-replay.test.ts — automated replayed-redirect induction for TEST-03 §4.3"
  - "tests/uat/webhook-retry.test.ts — automated webhook-retry induction for TEST-03 §4.4 (Method B / curl replay)"
  - "tests/uat/declined-card.test.ts — automated retrieveTransaction-level assertion for declined response shape (TEST-03 §4.1)"
  - "UAT_DECLINED_RESULT_KEY env var documented in tests/uat/README.md + .env.example"
affects:
  - "Plan 04-04 (wrap-up / cutover gate — depends on TEST-03 evidence bundle rows being populated)"
  - "Plan 04-05 (sign-off capture — depends on all three SC rows being ✅)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Curl-replay dedup induction (Method B) — authoritative over natural webhook retry (Method A is unreliable per RESEARCH.md Pitfall 4)"
    - "Retrieve-level shape assertion for declined paths — test proves magic-expiry convention + dual-verification inversion (Approved:false despite APIResponse.ResponseCode===0)"
    - "Evidence-capture console.log pattern — test emits the exact `vercel logs | grep` command the operator runs, making log-visible assertions discoverable"

key-files:
  created:
    - "tests/uat/confirm-replay.test.ts (58 lines)"
    - "tests/uat/webhook-retry.test.ts (65 lines)"
    - "tests/uat/declined-card.test.ts (61 lines)"
  modified:
    - "tests/uat/README.md (UAT_DECLINED_RESULT_KEY added to 'How to run') — actually committed by 04-01's runbook commit 77456c7 due to parallel-agent race; content is correct"
    - ".env.example (UAT_DECLINED_RESULT_KEY section) — same 04-01 coalesced commit"

key-decisions:
  - "webhook retry test uses curl replay (Method B) over natural retry (Method A) — Method A is unreliable per Pitfall 4; curl replay deterministically exercises the same SETNX namespace the natural retry would"
  - "declined-card test asserts at retrieveTransaction level rather than at confirm-route redirect level — retrieveTransaction response shape is the authoritative declined evidence; UI-level declined bucket assertion stays manual per plan (operator screenshot)"
  - "Both replay tests include a second 'behavioral-only' it() block that asserts expect(true).toBe(true) — intentionally sparse; the real assertion is Vercel-log-grep-visible, captured to .log files by the operator per RUNBOOK §4.3/§4.4"
  - "Separate env var UAT_DECLINED_RESULT_KEY (distinct from UAT_RESULT_KEY) — declined and approved runs produce different ResultKeys; mixing them would break dedup assumptions"
  - "Did NOT inline RUNBOOK-style evidence-capture commands into test assertions — tests drive HTTP, operator drives log capture; keeps test files small and the source-of-truth for runbook steps in 04-RUNBOOK.md"

patterns-established:
  - "Cross-route dedup proof via shared SETNX namespace: two test files (confirm-replay + webhook-retry) exercise the same `bpoint-txn:{TxnNumber}` key, and the cross-route assertion is that the webhook test sees collisions even on the FIRST POST because the confirm route already owns the key from Plan 02's happy-path run"
  - "Env-gated UAT test pattern: import { assertUatGate, loadPreviewEnv } from ./setup → describe.skipIf(!UAT_SMOKE) → beforeAll calls assertUatGate + loadPreviewEnv; mirrors Plan 04-02's pattern"

requirements-completed: []  # TEST-03 is NOT yet verified — automation landed, but live evidence capture is blocked at Task 3 checkpoint

# Metrics
duration: 3 min (Tasks 1–2 automation only; Task 3 is a blocking operator checkpoint)
completed: 2026-04-24
---

# Phase 4 Plan 3: TEST-03 Failure-Path Automation Summary

**Three env-gated UAT tests that deterministically induce replayed-redirect, webhook-retry, and declined-card failure paths; evidence capture for all four TEST-03 scenarios (including the manual 31-minute expired-AuthKey wait) is gated at an operator checkpoint.**

## Performance

- **Duration:** 3 min (automation only — operator checkpoint not included)
- **Started:** 2026-04-24T11:29:59Z
- **Completed:** 2026-04-24T11:33:29Z (automation); Task 3 checkpoint pending operator
- **Tasks:** 2 of 3 complete (Task 3 is a blocking `checkpoint:human-verify`)
- **Files created:** 3 (tests)
- **Files modified:** 2 (tests/uat/README.md, .env.example — coalesced into 04-01's commit 77456c7 via parallel-agent race)

## Accomplishments

- **Automated replayed-redirect dedup induction** — `tests/uat/confirm-replay.test.ts` drives two GETs to `/api/checkout/confirm?ResultKey=...&ResponseCode=0`, asserts both return a success redirect (302/303/307/308 with `Location` matching `/payment=success/`). Gives operator a deterministic way to trigger the `[bpoint-confirm] duplicate ignored` log line.
- **Automated webhook-retry dedup induction** — `tests/uat/webhook-retry.test.ts` drives two POSTs to `/api/webhooks/bpoint?ResultKey=...`, asserts both return 200 `{received: true}` per WEBH-04. Cross-route SETNX dedup is log-visible only (both POSTs see collision because Plan 02 confirm-route already won the SETNX key).
- **Automated declined-card shape assertion** — `tests/uat/declined-card.test.ts` calls `retrieveTransaction(UAT_DECLINED_RESULT_KEY)` and asserts `APIResponse.ResponseCode===0`, `TxnResp.Approved===false`, `BankResponseCode==="05"`, and `Amount ∈ [132000, 72600]` integer cents.
- **Env-var documentation** — `UAT_DECLINED_RESULT_KEY` added to both `.env.example` and `tests/uat/README.md` with cross-reference to RUNBOOK §4.1 for capture procedure.

## Task Commits

1. **Task 1: Create tests/uat/confirm-replay.test.ts** — `5652839` (test)
2. **Task 2: Create tests/uat/webhook-retry.test.ts + tests/uat/declined-card.test.ts** — `7388491` (test)
3. **Task 3: Execute RUNBOOK §4 + capture evidence** — BLOCKING checkpoint (pending operator)

**Plan metadata commit:** pending (held until Task 3 checkpoint resolves)

_Note: README.md + .env.example edits that my plan assigned to Task 2 were coalesced into 04-01's runbook commit `77456c7` due to parallel-agent race (04-01 staged those files after my edits hit disk but before my `git add` ran). Net effect is correct; both edits landed atomically with 04-01's related runbook/evidence work._

## Files Created/Modified

- `tests/uat/confirm-replay.test.ts` — TEST-03 §4.3 replayed-redirect induction (2 tests, UAT_SMOKE-gated, redirect: manual, evidence-capture console.log)
- `tests/uat/webhook-retry.test.ts` — TEST-03 §4.4 webhook-retry induction (2 tests, UAT_SMOKE-gated, Method B curl replay, cross-route dedup narrative)
- `tests/uat/declined-card.test.ts` — TEST-03 §4.1 retrieveTransaction shape (3 tests, UAT_SMOKE-gated + UAT_DECLINED_RESULT_KEY-gated)
- `tests/uat/README.md` — added `UAT_DECLINED_RESULT_KEY=<uuid-from-declined-run>` line to 'How to run' block (via 04-01 commit 77456c7)
- `.env.example` — added `UAT_DECLINED_RESULT_KEY=` section under UAT validation block with RUNBOOK §4.1 cross-reference (via 04-01 commit 77456c7)

## Decisions Made

- **Curl-replay (Method B) over natural retry (Method A) for webhook-retry test.** BPoint's natural retry cadence is not publicly documented (RESEARCH.md Pitfall 4). Method A would be flaky and require long waits + preview-URL toggling. Curl replay deterministically hits the same SETNX namespace with zero timing dependency.
- **Retrieve-level declined assertion, not confirm-route-level.** `retrieveTransaction` response shape (APIResponse.ResponseCode + TxnResp.Approved + BankResponseCode) is the authoritative evidence that BPoint's response-code simulation fired correctly on expiry `99/05`. Confirm-route UI bucket (`/?payment=failed&reason=declined`) is a downstream rendering — operator captures via screenshot per RUNBOOK §4.1.
- **Sparse second `it()` blocks with `expect(true).toBe(true)`.** Kept intentionally — the real assertion is Vercel-log-grep-visible and dashboard-visible (Resend + Zapier), neither of which can be programmatically queried from vitest. The second block drives the cross-route scenario narrative + documents the manual verification the operator performs.
- **Separate `UAT_DECLINED_RESULT_KEY` env var, not reusing `UAT_RESULT_KEY`.** Approved and declined ResultKeys are different BPoint transactions. Mixing them would violate the dedup narrative (declined never fires fan-out, so `bpoint-txn:{TxnNumber}` key is never set; approved key is).

## Deviations from Plan

### None — plan executed exactly as written through Tasks 1-2.

_Task 3 is a `checkpoint:human-verify` gate, not a deviation. Execution pauses there by design._

### Coordination notes (not deviations)

- **Parallel-agent coordination race:** Plan 04-01 (Wave 0 scaffolding) and Plans 04-02/04-03 (Wave 1 tests) executed concurrently in the same worktree. When I started, 04-01 had landed only its Task 1 (vitest.config + .env.example UAT_SMOKE block) commit. `tests/uat/setup.ts` and `tests/uat/fixtures/test-pans.ts` were on disk as "placeholder" files written by 04-02 with interfaces matching 04-01's spec verbatim (by plan design — 04-01 task 2 was racing to overwrite them). By the time I committed Task 2, 04-01 had committed its Task 2 (setup.ts, README.md, fixtures) and Task 3 (runbook, evidence bundle). My README.md + .env.example edits were swept into 04-01's final commit because 04-01's agent staged after my edits hit disk but before I ran `git add`. Content is correct in both places; no conflicts.
- **No Rule-N deviations fired.** All automation work stayed in the plan's assigned files.

**Total deviations:** 0
**Impact on plan:** None. Tasks 1-2 shipped exactly as specified.

## Issues Encountered

None during automation. Task 3 checkpoint is the expected blocking gate.

## Authentication Gates

None triggered during automation. Tasks 1-2 are file creation + commit only; no CLI tool auth required.

Live UAT execution (Task 3) will require multiple auth gates when operator runs it:
- Vercel CLI auth (`vercel login`) — to pull preview env + tail logs
- BPoint UAT credentials in Vercel Preview env — from 1Password (documented in RUNBOOK §1)
- Resend dashboard access — to verify 1 receipt per `bpointTxnNumber`
- Zapier dashboard access — to verify 1 transcript per `bpointTxnNumber`

## User Setup Required

This plan's frontmatter has no `user_setup` block (inherits Plan 04-02's UAT setup — same BPoint UAT + Vercel preview + UAT_SMOKE / UAT_PREVIEW_URL / UAT_RESULT_KEY). One new env var added by this plan:

- `UAT_DECLINED_RESULT_KEY` — captured by operator from Vercel log `[bpoint-confirm]` line after running RUNBOOK §4.1 (declined card run with PAN 5123456789012346, expiry 99/05, CVN 000).

No new dashboard configuration. No new accounts. See `.planning/phases/04-validation/04-RUNBOOK.md` §4 for full operator procedure.

## Next Phase Readiness

**Automation complete; evidence capture pending.** The three UAT tests are committed, TypeScript-clean, and default `npm test` remains 49/49 green with the UAT directory silently excluded.

**Blocking before Plan 04 can advance:**
1. **BPoint HPP activation** (external — same blocker as Plan 04-02). Firm must call BPoint support 1300 766 031, Support Code 273 516, merchant 5353109297032146, to enable Hosted Payment Page product. Until activated, `createAuthKey` returns `ResponseCode: 2 "Invalid permissions"` — no iframe can render → no §4.1 declined run → no §4.2 expired-AuthKey run → no happy-path ResultKey → no §4.3/§4.4 replay targets.
2. **31-minute wall-clock wait** (§4.2) — authentic AuthKey expiry is non-negotiable per CONTEXT (no test-only code in prod paths). Operator runs §4.1, §4.3, §4.4 in parallel during the wait.
3. **Operator evidence capture** — four artefacts (sc3-declined.png, sc3-expired-authkey.png, sc3-replayed-redirect.log, sc3-webhook-retry.log) + four evidence-bundle §4.1-§4.4 rows populated + Resend/Zapier dashboard counts pasted.

**Once checkpoint resolves:** Plan 04-04 (wrap-up) can run, followed by Plan 04-05 (sign-off capture). Phase 4 cutover gate requires TEST-01 ✅ + TEST-02 ✅ + TEST-03 ✅ + firm sign-off quote.

## Self-Check

- [x] `tests/uat/confirm-replay.test.ts` exists on disk
- [x] `tests/uat/webhook-retry.test.ts` exists on disk
- [x] `tests/uat/declined-card.test.ts` exists on disk
- [x] `UAT_DECLINED_RESULT_KEY` present in `tests/uat/README.md`
- [x] `UAT_DECLINED_RESULT_KEY` present in `.env.example`
- [x] Task 1 commit `5652839` exists: `git log --oneline --all | grep 5652839`
- [x] Task 2 commit `7388491` exists: `git log --oneline --all | grep 7388491`
- [x] `npx tsc --noEmit` exits 0
- [x] `npx vitest run --reporter=dot` exits 0 (49/49 green; UAT dir silently excluded)

**Self-Check: PASSED** — all automation deliverables verified on disk + in git history + TypeScript clean + default suite green. Task 3 evidence-capture deliverables remain pending (checkpoint).

---

*Phase: 04-validation*
*Completed: 2026-04-24 (automation only — Task 3 checkpoint pending operator)*
