---
phase: 03-webhook-cleanup
plan: 01
subsystem: testing

tags: [vitest, webhook, bpoint, tdd, red-scaffold]

# Dependency graph
requires:
  - phase: 02-confirmation-ui
    provides: retrieveTransaction, handleConfirmedPayment, bpoint-responses fixtures
provides:
  - RED test scaffold for POST /api/webhooks/bpoint (9 cases)
  - Behavior contract for Plan 02 webhook route implementation
  - Symmetric mock pattern mirroring tests/confirm-route.test.ts
affects: [03-webhook-cleanup P02]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RED-first TDD scaffold: tests land before route, import resolution failure is the expected RED signal"
    - "Mock symmetry: POST webhook tests reuse confirm-route mock shape verbatim (no new mock patterns)"
    - "Fixture reuse: approved/declined/expired BPoint responses shared across confirm + webhook tests"

key-files:
  created:
    - tests/webhook-bpoint.test.ts
  modified: []

key-decisions:
  - "Scaffolded 9 cases (8 from 03-RESEARCH.md + 1 explicit defensive-casing probe locked by 03-CONTEXT.md)"
  - "No new fixture file — reused tests/fixtures/bpoint-responses.ts verbatim to keep confirm and webhook symmetric"
  - "Mock shape copied verbatim from tests/confirm-route.test.ts — zero symmetry debt for Plan 02"
  - "RED signal is 'Failed to resolve import @/app/api/webhooks/bpoint/route' — Plan 02 turns this green"

patterns-established:
  - "Wave 0 test-first pattern for webhook plans: write all RED cases before the route file exists"
  - "makeReq helper signature POST-adapted: new Request(url, { method: 'POST' }) matches webhook semantics"

requirements-completed: []  # WEBH-01..04 not yet complete — scaffold only; Plan 02 turns them green

# Metrics
duration: 1min
completed: 2026-04-24
---

# Phase 03 Plan 01: BPoint Webhook RED Test Scaffold Summary

**Nine RED Vitest cases for POST /api/webhooks/bpoint covering WEBH-01..04 + dedup + defensive casing — behavior contract locked before Plan 02 implements the route**

## Performance

- **Duration:** ~1 min
- **Started:** 2026-04-24T06:02:20Z
- **Completed:** 2026-04-24T06:03:13Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- 9 RED test cases scaffolded in `tests/webhook-bpoint.test.ts` (101 lines)
- Behavior contract established for Plan 02 webhook route: ResultKey missing no-op, query parsing (both casings), decline/expired short-circuit, approved fan-out with mapped fields, SETNX dedup, and WEBH-04 never-fail-the-webhook semantics for both downstream-throw paths
- Mock symmetry with `tests/confirm-route.test.ts`: same three `vi.mock` targets (`@/lib/bpoint`, `@/lib/payments/handleConfirmedPayment`, `@/lib/kv`), same fixture imports
- RED signal confirmed exactly as designed: Vitest fails with `Failed to resolve import @/app/api/webhooks/bpoint/route` — Plan 02 flips this to green
- Pre-existing 40 tests continue to pass; no regressions introduced

## Task Commits

Each task was committed atomically:

1. **Task 1: Create tests/webhook-bpoint.test.ts with 9 RED cases** — `46b18ba` (test)

_Plan metadata commit follows this summary._

## Files Created/Modified

- `tests/webhook-bpoint.test.ts` — RED scaffold: 9 `it(...)` blocks, 3 `vi.mock` declarations, reuses approved/declined/expired fixtures

## Decisions Made

- **9 cases not 8** — 03-RESEARCH.md lists 8, but 03-CONTEXT.md locks defensive casing (`resultkey` lowercase) as a hard requirement, so an explicit 9th case was added. The plan's `<behavior>` block authorizes this (numbered item 3).
- **Fixture reuse over duplication** — webhook flow consumes the same `BPointTxnResponse` shape as confirm flow, so `approvedTxnResponse` / `declinedTxnResponse` / `expiredAuthKeyResponse` were reused verbatim. `invalidCardTxnResponse` was intentionally not imported (webhook doesn't need bucket-level granularity at the route level).
- **POST-specific `makeReq` helper** — identical to confirm's helper except `{ method: "POST" }` is added to the Request constructor. Keeps the two test files diffable line-by-line for future maintainers.
- **No source files touched** — tests-only plan by design; Plan 02 implements the route to turn this RED suite green.

## Deviations from Plan

None — plan executed exactly as written. The `<action>` block prescribed the file contents verbatim and was followed 1:1.

## Issues Encountered

None. First vitest run produced the exact expected RED signal on the first try.

## User Setup Required

None — no external service configuration required for this plan.

## Next Phase Readiness

- Plan 02 (webhook route implementation) is unblocked: the behavior contract is pinned, the fixtures are ready, the mock shape is settled.
- Plan 02 TDD cycle: implement `src/app/api/webhooks/bpoint/route.ts` with a `POST` export until all 9 RED cases go green, then run `npm test` to confirm the full 49-case suite (40 pre-existing + 9 new) passes.
- External blockers from 03-CONTEXT.md (BPoint UAT credentials, Merchant Back Office webhook URL config) remain; they do not gate Plan 02 code landing — they gate end-to-end UAT validation.

## Self-Check

All claims verified:

- `tests/webhook-bpoint.test.ts` exists (FOUND)
- Commit `46b18ba` exists in git log (FOUND)
- 9 `it(` blocks present (verified via `grep -c`)
- 3 `vi.mock("@/lib/...")` declarations present (verified)
- Fixture import present (verified)
- No new fixture file created (verified)
- Vitest RED signal matches expected "Failed to resolve import" (verified)
- Pre-existing 40 tests pass (verified)

## Self-Check: PASSED

---
*Phase: 03-webhook-cleanup*
*Completed: 2026-04-24*
