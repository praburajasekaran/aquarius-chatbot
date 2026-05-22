---
phase: 02-confirmation-ui
plan: 01
subsystem: payments
tags: [bpoint, confirm-route-prep, failure-bucketing, server-side-verification]
dependency-graph:
  requires:
    - "Plan 02-00: tests/bpoint.test.ts + tests/bucket-bank-code.test.ts RED scaffolds"
    - "Plan 01-02: existing getBpointConfig + buildBpointAuthHeader helpers in src/lib/bpoint.ts"
  provides:
    - "retrieveTransaction(resultKey) — authoritative server-side BPoint txn lookup (CONF-02)"
    - "BPointTxnResp + BPointTxnResponse exported types"
    - "bucketBankCode(code) — maps BankResponseCode to declined|invalid|system (UI-02)"
    - "FailureBucket type"
  affects:
    - "Plan 02-02 (confirm route consumes retrieveTransaction + bucketBankCode)"
    - "Plan 02-04 (ChatWidget uses failureReason values emitted by the bucket mapper)"
tech-stack:
  added: []
  patterns:
    - "Reuse existing private helpers (getBpointConfig, buildBpointAuthHeader) — no config or auth-header duplication"
    - "APIResponse.ResponseCode-as-number decoding (consistent with createAuthKey; verified in 01-VERIFICATION.md)"
    - "Pure synchronous lookup helper with Set-based code membership (no I/O, no env reads)"
key-files:
  created:
    - "src/lib/payments/bucket-bank-code.ts"
  modified:
    - "src/lib/bpoint.ts (appended retrieveTransaction + 2 response types; existing createAuthKey exports untouched)"
decisions:
  - "retrieveTransaction reuses the existing getBpointConfig + buildBpointAuthHeader helpers rather than duplicating config/header logic — single source of truth for BPoint auth semantics"
  - "Unknown / empty BankResponseCode defaults to 'system' bucket (locked in 02-CONTEXT.md) — avoids leaking raw codes into UI while keeping exhaustive enum safe"
  - "Error message text is 'BPoint retrieve failed: {status}' (exact string pinned by test regex) — stable contract for downstream confirm-route error handling"
metrics:
  duration: 1min
  completed: 2026-04-24T04:45:30Z
  tasks: 2
  files: 2
---

# Phase 02 Plan 01: BPoint retrieveTransaction + bucketBankCode Summary

One-liner: Added server-side `retrieveTransaction(resultKey)` to `src/lib/bpoint.ts` and created `src/lib/payments/bucket-bank-code.ts` with a pure `bucketBankCode` mapper — the two pure helpers Plan 02-02's confirm route will consume to perform authoritative verification (CONF-02) and produce sanitized user-facing failure reasons (UI-02).

## What Was Built

### 1. retrieveTransaction + types (Task 1)

- **src/lib/bpoint.ts** (appended, 48 lines): exports `BPointTxnResp`, `BPointTxnResponse`, and `async function retrieveTransaction(resultKey: string): Promise<BPointTxnResponse>`.
- Issues `GET https://www.bpoint.com.au/webapi/v2/txns/{resultKey}` with the same `Authorization: Basic <b64(username|merchant:password)>` header used by `createAuthKey`, reusing `getBpointConfig()` and `buildBpointAuthHeader(...)` verbatim.
- Non-OK HTTP responses log with the `[bpoint]` tag and throw `BPoint retrieve failed: {status}` (exact string pinned by the test regex).
- `TxnResp` typed as `BPointTxnResp | null` — reflects the APIResponse != 0 case (e.g. expired AuthKey) where BPoint returns no transaction payload.
- Existing `createAuthKey` export and signature untouched.

### 2. bucketBankCode mapper (Task 2)

- **src/lib/payments/bucket-bank-code.ts** (new, 38 lines): exports `FailureBucket = "declined" | "invalid" | "system"` and `bucketBankCode(code: string): FailureBucket`.
- `DECLINED_CODES` Set: `05, 51, 54, 57, 61, 62, 65, 91` (issuer-level declines — "try another card").
- `INVALID_CODES` Set: `14, 55, 82, N7` (format/CVV/PIN errors — "check card details").
- Default return is `"system"` for any unmatched code, including empty string — deliberate UI-02 safety: raw BankResponseCode never leaks, and new/rare codes degrade gracefully rather than crashing the UI.
- Pure sync function, no I/O, no env reads — cheap to call per-request inside the confirm route.

## Verification

### Automated

- `npx vitest run tests/bpoint.test.ts --reporter=dot`: 2/2 pass (calls GET with Basic Auth, throws on non-OK).
- `npx vitest run tests/bucket-bank-code.test.ts --reporter=dot`: 15/15 pass (all 12 mapped codes + 2 unknown + empty-string default).
- Combined run: **17/17 GREEN**, no failures.
- `npx tsc --noEmit`: 0 errors in `src/lib/bpoint.ts` and `src/lib/payments/bucket-bank-code.ts`.

### Acceptance criteria

- `grep -c "^export async function createAuthKey" src/lib/bpoint.ts` → `1` (preserved)
- `grep -c "^export async function retrieveTransaction" src/lib/bpoint.ts` → `1`
- Both new interfaces present; URL template literal intact; error-message text matches regex.
- `test -f src/lib/payments/bucket-bank-code.ts` → OK
- All 8 declined codes + all 4 invalid codes present in the file (grep sweep returned no MISSING lines).

## Deviations from Plan

None — plan executed exactly as written. No auto-fixes triggered (no Rule 1-3 issues discovered), no architectural decisions needed (no Rule 4 triggers), no authentication gates hit.

## Commits

| Task | Commit  | Description                                                                  |
| ---- | ------- | ---------------------------------------------------------------------------- |
| 1    | a7666ba | feat(02-01): add retrieveTransaction and txn response types to bpoint client |
| 2    | 77f8432 | feat(02-01): add bucketBankCode mapper for UI failure buckets                |

## Handoff to Downstream Plans

- **Plan 02-02 (confirm route)**: will call `retrieveTransaction(ResultKey)` with the URL param; gate fan-out on `APIResponse.ResponseCode === 0 && TxnResp?.Approved === true`; pass `TxnResp.BankResponseCode` through `bucketBankCode(...)` to build the `?payment=failed&reason={bucket}` redirect.
- **Plan 02-04 (ChatWidget URL signal)**: the three bucket string literals (`declined`, `invalid`, `system`) are the allowed `reason` values; unknown `reason` falls back to `system` in the widget (mirrors the mapper's default).
- `BPointTxnResp` and `BPointTxnResponse` are now the canonical types for confirm-route response decoding; `tests/fixtures/bpoint-responses.ts` (authored in Plan 02-00) is now fully typed against these exports.

## Self-Check: PASSED

- `src/lib/bpoint.ts`: FOUND (modified in commit `a7666ba`)
- `src/lib/payments/bucket-bank-code.ts`: FOUND (created in commit `77f8432`)
- Commit `a7666ba`: FOUND in git history
- Commit `77f8432`: FOUND in git history
- `tests/bpoint.test.ts`: GREEN (2/2)
- `tests/bucket-bank-code.test.ts`: GREEN (15/15)
