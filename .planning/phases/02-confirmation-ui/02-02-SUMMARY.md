---
phase: 02-confirmation-ui
plan: 02
subsystem: payments
tags: [bpoint, fan-out, shared-helper, redis, resend, zapier]

dependency-graph:
  requires:
    - phase: 02-confirmation-ui
      provides: "RED test tests/handle-confirmed-payment.test.ts pinning fan-out contract"
    - phase: 01-foundation
      provides: "bpointTxnNumber field in SessionData/IntakeRecord; Redis + Resend wiring"
  provides:
    - "src/lib/payments/handleConfirmedPayment.ts — shared post-payment fan-out helper"
    - "HandleConfirmedPaymentArgs interface (sessionId, bpointTxnNumber, amountCents)"
    - "Throws-on-null-intake contract (caller owns try/catch)"
    - "bpoint-txn:{TxnNumber} dedup key upgrade pattern (pending → hashToken(rawToken))"
  affects:
    - "Plan 02-03 confirm route (imports handleConfirmedPayment)"
    - "Phase 3 BPoint webhook (imports the same helper; no duplication)"

tech-stack:
  added: []
  patterns:
    - "Shared fan-out helper consumed by two entry points (GET confirm + POST webhook)"
    - "getIntake BEFORE side effects — null-check short-circuits cleanly so partial fan-out never occurs"
    - "Dedup-key upgrade: SETNX 'pending' (caller) → SET hash(token) (helper) preserves TTL window"
    - "Caller-owned try/catch — helper surfaces failures; confirm route redirects, webhook returns 200"

key-files:
  created:
    - "src/lib/payments/handleConfirmedPayment.ts"
  modified: []

key-decisions:
  - "Order: getIntake → updateSession → createUploadToken → dedup-key upgrade → receipt email → transcript email (null-intake short-circuit before any side effect; matches test 5)"
  - "Dedup key prefix is bpoint-txn:{TxnNumber} (not stripe-session:{id}) — aligns with Phase 3 webhook naming"
  - "Amount comes from args.amountCents (authoritative), not intake.amountCents — mirrors Stripe session.amount_total behaviour"
  - "Log tag [payments] per CONTEXT.md — distinguishes shared helper from confirm-route/webhook-specific logs"

patterns-established:
  - "Shared payment fan-out: one helper, two call sites (confirm route + webhook)"
  - "Throws on missing intake rather than silent skip — caller decides user-facing outcome"

requirements-completed: [CONF-04]

duration: 1min
completed: 2026-04-24
---

# Phase 02 Plan 02: Shared Post-Payment Fan-Out Helper Summary

**New `src/lib/payments/handleConfirmedPayment.ts` extracted from Stripe-webhook fan-out — session update + upload-token mint + bpoint-txn dedup-key upgrade + client receipt email + firm transcript email — consumed by Phase 2 confirm route and Phase 3 BPoint webhook.**

## Performance

- **Duration:** 58s (~1 min)
- **Started:** 2026-04-24T04:14:15Z
- **Completed:** 2026-04-24T04:15:13Z
- **Tasks:** 1
- **Files modified:** 1 (created)

## Accomplishments

- Shared fan-out helper created with BPoint-shaped signature (`{ sessionId, bpointTxnNumber, amountCents }`).
- All five fan-out steps present in the correct order: `getIntake` → `updateSession` → `createUploadToken` → dedup-key upgrade → receipt email → transcript email.
- `getIntake(sessionId) === null` throws before any side effect — caller (confirm route / webhook) decides whether to log, redirect, or 200.
- `bpoint-txn:{TxnNumber}` dedup key upgraded from `"pending"` (set by caller via SETNX) to `hashToken(rawToken)` with the same 7-day TTL.
- All 5 tests in `tests/handle-confirmed-payment.test.ts` GREEN; no TypeScript errors introduced (`tsc --noEmit` is clean for the new file).

## Task Commits

Each task was committed atomically:

1. **Task 1: Create `src/lib/payments/handleConfirmedPayment.ts`** — `a060b50` (feat)

_Note: No TDD RED commit because tests/handle-confirmed-payment.test.ts was authored in Plan 02-00 (commit 320e81a)._

## Files Created/Modified

- `src/lib/payments/handleConfirmedPayment.ts` — shared post-payment fan-out helper (107 lines). Exports `handleConfirmedPayment()` and `HandleConfirmedPaymentArgs` type. Imports: `@/lib/kv`, `@/lib/intake`, `@/lib/upload-tokens`, `@/lib/resend`, `@/lib/email/assert-no-tracking`, `@/lib/email/payment-receipt`, `@/lib/branding`.

## Decisions Made

- **Order: intake first, then side effects.** `getIntake` happens before `updateSession`/`createUploadToken`/emails so a null intake (Redis evicted or unknown sessionId) short-circuits cleanly without leaving the session half-updated. Matches test 5 `throws when getIntake returns null`.
- **Dedup key prefix `bpoint-txn:`.** Phase 3 naming aligned now so the confirm route and webhook converge on the same key space. (Stripe webhook's `stripe-session:` is untouched — Phase 3 deletes that file entirely.)
- **`args.amountCents` is authoritative.** The helper uses the caller-supplied amount (from BPoint `TxnResp.Amount`) rather than `intake.amountCents`, mirroring how the Stripe webhook used `session.amount_total`. Prevents drift if a client modifies the amount in-session.
- **Caller owns the try/catch.** Helper throws; confirm route will catch + redirect to `?payment=system-error`, webhook will catch + return 200 (next phase). Keeps helper pure.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. Stripe webhook reference implementation translated cleanly; all tests passed on first run.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Plan 02-03 (confirm route)** can now import `handleConfirmedPayment` from `@/lib/payments/handleConfirmedPayment` and wire it into `GET /api/checkout/confirm` with a try/catch and `?payment=system-error` redirect on throw.
- **Phase 3 (BPoint webhook)** can import the same helper without duplication — satisfies ROADMAP.md Phase 3 SC#2 "helper must be shared".
- Stripe webhook at `src/app/api/webhooks/stripe/route.ts` is intentionally NOT modified (Phase 3 removes it entirely).

## Self-Check: PASSED

- `src/lib/payments/handleConfirmedPayment.ts` exists on disk (verified via `test -f`).
- Commit `a060b50` present in git history (`git log --oneline --all | grep a060b50`).
- All 5 tests in `tests/handle-confirmed-payment.test.ts` GREEN (verified via `npx vitest run`).
- `npx tsc --noEmit` reports 0 errors referencing the new file.

---
*Phase: 02-confirmation-ui*
*Completed: 2026-04-24*
