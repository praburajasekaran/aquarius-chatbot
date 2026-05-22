---
phase: 02-confirmation-ui
plan: 00
subsystem: testing
tags: [vitest, tdd, red-state, test-infrastructure]
dependency-graph:
  requires: []
  provides:
    - "vitest test runner configured"
    - "BPoint response fixtures (approved/declined/invalid/expired)"
    - "RED test contracts for CONF-01..CONF-05, UI-01, UI-02, UI-04"
    - "scrollIntoView polyfill for jsdom"
  affects:
    - "Plans 02-01..02-04 (all downstream plans must turn these RED tests GREEN)"
tech-stack:
  added:
    - "vitest@^2.1.9"
    - "@vitejs/plugin-react@^4.7.0"
    - "@testing-library/react@^16.3.2"
    - "@testing-library/jest-dom@^6.9.1"
    - "@testing-library/user-event@^14.6.1"
    - "jsdom@^25.0.1"
    - "vite-tsconfig-paths@^5.1.4"
  patterns:
    - "environmentMatchGlobs (jsdom for .tsx, node for .ts)"
    - "vi.mock() module-level mocking of @/lib/* barrels"
    - "vi.resetModules() between URL-param tests for useEffect re-evaluation"
    - "Fixture-driven test data (tests/fixtures/bpoint-responses.ts)"
key-files:
  created:
    - "vitest.config.mts"
    - "tests/setup.ts"
    - "tests/fixtures/bpoint-responses.ts"
    - "tests/bpoint.test.ts"
    - "tests/bucket-bank-code.test.ts"
    - "tests/confirm-route.test.ts"
    - "tests/handle-confirmed-payment.test.ts"
    - "tests/payment-card.test.tsx"
    - "tests/chat-widget.test.tsx"
  modified:
    - "package.json (added test/test:watch scripts + 7 devDependencies)"
decisions:
  - "Use vitest.config.mts (not .ts) because vite-tsconfig-paths is ESM-only"
  - "Add scrollIntoView polyfill in tests/setup.ts — jsdom does not implement it and chat-widget calls it in useEffect"
  - "environmentMatchGlobs over per-file directives — .tsx -> jsdom, .ts -> node default"
metrics:
  duration: 4min
  completed: 2026-04-24T04:11:12Z
  tasks: 4
  files: 9
---

# Phase 02 Plan 00: Test Framework + RED Scaffolds Summary

One-liner: Installed vitest + RTL + jsdom and authored six RED test files (BPoint client, bank-code bucketing, confirm route, handleConfirmedPayment fan-out, PaymentCard iframe, ChatWidget URL-param signal) pinning the exact contracts Plans 01-04 must satisfy.

## What Was Built

### 1. Test infrastructure (Task 1)

- **package.json**: Added `"test": "vitest run --reporter=dot"` and `"test:watch": "vitest"` scripts. Added 7 devDependencies.
- **vitest.config.mts**: `@vitejs/plugin-react` + `vite-tsconfig-paths` with `environmentMatchGlobs` wiring `tests/**/*.test.tsx` to jsdom and leaving `.ts` tests on the node default.
- **tests/setup.ts**: Imports `@testing-library/jest-dom/vitest` matchers; polyfills `Element.prototype.scrollIntoView` for jsdom.
- **npm test** runs cleanly (no parse/crash errors).

### 2. Shared fixtures (Task 2)

- **tests/fixtures/bpoint-responses.ts** exports four fixtures typed against the planned `BPointTxnResponse`: approved (BankResponseCode `00`), declined (`05`), invalid card (`14`), expired AuthKey (`ResponseCode=5001`, `TxnResp=null`). These import the type from `@/lib/bpoint` — intentionally unresolvable until Plan 01 adds it.

### 3. RED unit tests (Task 3)

| File | Requirements | Tests | Contract pinned |
|------|--------------|-------|-----------------|
| `tests/bpoint.test.ts` | CONF-02 | 2 | `retrieveTransaction(resultKey)` calls `GET https://www.bpoint.com.au/webapi/v2/txns/{resultKey}` with Basic Auth; throws `BPoint retrieve failed: {status}` on non-OK |
| `tests/bucket-bank-code.test.ts` | UI-02 | 15 (it.each) | `bucketBankCode('05'\|'51'\|...)` -> `declined`; `('14'\|'55'\|...)` -> `invalid`; unknown/empty -> `system` |
| `tests/confirm-route.test.ts` | CONF-01/03/04/05 | 8 | Missing/early-exit redirects to `?payment=failed`; calls `retrieveTransaction(ResultKey)`; fans out to `handleConfirmedPayment({sessionId: Crn1, bpointTxnNumber: TxnNumber, amountCents: Amount})` only when `APIResponse.ResponseCode===0 && TxnResp.Approved===true`; SETNX dedup; `?payment=success` redirect |
| `tests/handle-confirmed-payment.test.ts` | CONF-04 | 5 | `updateSession(sessionId, {paymentStatus:'paid', bpointTxnNumber, paymentAmount})`, `createUploadToken({matterRef, clientEmail, clientName, sessionId})`, `resend.emails.send`, `sendTranscriptEmail({bpointTxnNumber, paymentAmount, ...})`, throws when `getIntake` returns null |
| `tests/payment-card.test.tsx` | UI-01, UI-04 | 4 | Renders iframe with `src=https://www.bpoint.com.au/webapi/v2/txns/iframe/{authKey}`; no Stripe `EmbeddedCheckoutProvider`; `failureReason='expired'` renders expiry UI + "Start again" button; click refetches `/api/checkout` |

### 4. Chat-widget URL-signal scaffold (Task 4)

- **tests/chat-widget.test.tsx**: 6 RED tests pinning the Plan 04 Task 2 contract:
  - `?payment=success` -> onPaymentComplete pathway fires, no failureReason
  - `?payment=failed&reason=expired|declined` -> `failureReason` prop passed to MessageList
  - Unknown `reason` -> falls back to `system`
  - After handling, `window.history.replaceState` called to clear `?payment=`
  - No `?payment=` present -> no-op
- Mocks MessageList to spy on the prop surface; mocks `@ai-sdk/react` + `ai` so ChatWidget mounts in isolation; uses `vi.resetModules()` per test so each render re-evaluates the URL-param `useEffect`.

## Verification

- `npm test` runs vitest and reports 6 test files failing (RED), 9 tests failing, 3 incidentally passing. No parse errors, no vitest crashes.
- All acceptance criteria across Tasks 1-4 pass (script names, dep versions, file existence, export counts, grep-based content checks).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] vitest.config.ts -> vitest.config.mts**
- **Found during:** Task 1 verification (`npm test` startup error)
- **Issue:** `vite-tsconfig-paths@^5` is ESM-only; esbuild's `externalize-deps` plugin refused to load it from a CJS-resolved `vitest.config.ts`.
- **Fix:** Renamed to `vitest.config.mts`. Identical content; forces Node to treat as ESM.
- **Files modified:** `vitest.config.mts` (renamed from `vitest.config.ts`)
- **Commit:** 3669d43

**2. [Rule 3 - Blocking] scrollIntoView polyfill**
- **Found during:** Task 4 verification (chat-widget tests crashed in useEffect)
- **Issue:** jsdom does not implement `Element.prototype.scrollIntoView`; ChatWidget's mount-time `useEffect` threw "scrollIntoView is not a function", preventing assertions from running.
- **Fix:** Added 4-line no-op polyfill in `tests/setup.ts`.
- **Files modified:** `tests/setup.ts`
- **Commit:** 9c4d136

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 3669d43 | chore(02-00): install vitest and wire npm test |
| 2 | 7abd955 | test(02-00): add shared BPoint response fixtures |
| 3 | 320e81a | test(02-00): add RED unit tests for Phase 2 unit-testable requirements |
| 4 | 9c4d136 | test(02-00): add RED scaffold for chat-widget URL-param signal |

## Handoff to Downstream Plans

- **Plan 01** (BPoint client): export `BPointTxnResponse` type + `retrieveTransaction(resultKey)` — turns `tests/bpoint.test.ts` and the fixture import GREEN.
- **Plan 02** (bucket helper + confirm route): create `src/lib/payments/bucket-bank-code.ts` and `src/lib/payments/handleConfirmedPayment.ts`, wire `src/app/api/checkout/confirm/route.ts` — turns `tests/bucket-bank-code.test.ts`, `tests/handle-confirmed-payment.test.ts`, `tests/confirm-route.test.ts` GREEN.
- **Plan 03** (PaymentCard): replace Stripe iframe with BPoint iframe + expiry UX — turns `tests/payment-card.test.tsx` GREEN.
- **Plan 04** (ChatWidget): add URL-param `useEffect` with `replaceState` + failureReason state — turns `tests/chat-widget.test.tsx` GREEN.

## Self-Check: PASSED

All 10 listed files exist on disk. All 4 per-task commits exist in git history.
