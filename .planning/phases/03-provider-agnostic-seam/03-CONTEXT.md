# Phase 03: Provider-Agnostic Seam — Context

**Gathered:** 2026-05-12
**Status:** Ready for planning (partial — code discovered during research)
**Source:** Codebase analysis — most of Phase 3 is already implemented

---

## Phase Boundary

Wire SMS into the live app so payment success triggers immediate SMS, schedules the 24h reminder, and upload cancels the reminder — all through a single `handleIntakePaid()` seam that neither Stripe nor Bpoint types can leak through.

## Implementation Decisions

### Already Implemented (Discovered During Research)

The `handleIntakePaid()` orchestrator already exists at `src/lib/intake/handle-paid.ts` (324 lines) with full fan-out:
- Session marker (paid status) ✅
- Payment-level dedup with `stripe-session:{sessionId}` NX + `pending` recovery (legacy key name, provider-agnostic logic) ✅
- Upload token mint ✅
- Email payment receipt (Resend, best-effort) ✅
- Firm transcript email (Resend, best-effort) ✅
- Immediate SMS dispatch via `sendSms()` ✅
- 24h reminder scheduling via `scheduleReminderSms()` ✅
- Urgent firm staff SMS ✅

The payment webhook already calls `handleIntakePaid()` (Stripe route delegates, BPoint route will follow the same pattern) ✅

The late-upload handler (`src/lib/late-upload/handle-completed.ts`) already:
- Sets `uploaded:{sessionId}` Redis flag ✅
- Calls `cancelPendingReminder(sessionId)` ✅

### Remaining Work (6 items)

- **SMS-05** — `sms-immediate:{sessionId}` Redis NX key is NOT implemented inside `handleIntakePaid()`. The top-level payment dedup key already blocks retries in the common case, but the `pending` recovery path can re-enter the SMS dispatch. Adding the NX dedup inside the SMS dispatch block provides the defense-in-depth the requirement asks for.
- **In-chat upload** — `src/app/api/upload/route.ts` (POST /api/upload) does NOT call `cancelPendingReminder()`. Only the late-upload completion handler cancels.
- **TEST-02** — Integration test for payment webhook retry → exactly one SMS dispatched (tests SMS-05 dedup).
- **TEST-03** — Integration test for upload before reminder → reminder cancelled/skipped.

### Already Satisfied (No Work Required)

The following Phase 3 requirements are satisfied by existing code and require verification-only:
- EVENT-01 (single entry point) — `handleIntakePaid()` exists
- EVENT-02 (payment webhook refactored) — webhook already delegates
- EVENT-03 (provider-agnostic interface) — `HandleIntakePaidArgs` exists
- SMS-01 (immediate SMS) — dispatched inside `handleIntakePaid()`
- COMP-03 (sender ID from env var) — `sendSms()` reads `CLICKSEND_SENDER_ID`
- OPS-01 (absent-env boot) — all SMS functions are absent-env-safe
- OPS-02 (structured logging) — all dispatch paths log structured events

## Requirements

| REQ-ID | Description | Status | Phase 3 Work |
|--------|-------------|--------|-------------|
| EVENT-01 | Single `handleIntakePaid()` entry point | ✅ Done | None |
| EVENT-02 | Payment webhook refactored | ✅ Done | None |
| EVENT-03 | Provider-agnostic interface | ✅ Done | None |
| SMS-01 | Immediate SMS on payment | ✅ Done | None |
| SMS-05 | `sms-immediate` NX dedup | ❌ Missing | Add NX dedup in handleIntakePaid |
| COMP-03 | Sender ID from env var | ✅ Done | None |
| OPS-01 | Absent-env graceful boot | ✅ Done | None |
| OPS-02 | Structured logging | ✅ Done | None |
| TEST-02 | Payment webhook retry integration test | ❌ Missing | Write integration test |
| TEST-03 | Upload-gate cancel test | ❌ Missing | Write integration test |

## Mutated Files

- `src/lib/intake/handle-paid.ts` — add `sms-immediate` NX dedup before SMS dispatch
- `src/app/api/upload/route.ts` — add `cancelPendingReminder()` on successful upload

## New Files

- `src/lib/intake/__tests__/handle-paid.test.ts` — integration tests for retry dedup + upload-gate cancel

## Success Criteria (from ROADMAP)

1. SMS arrives within 30s of simulated payment → Verified by existing code (SMS dispatch path fires correctly)
2. Payment webhook retry → exactly one SMS send → TEST-02 will verify this
3. Zero Stripe imports in SMS module → Already verified (SMS-02 from Phase 1)
4. App boots without CLICKSEND_*/QSTASH_* vars → Already verified by Phase 1/2 tests
5. Upload before 24h → reminder cancelled → TEST-03 will verify this

---

*Phase: 03-provider-agnostic-seam*
*Context gathered: 2026-05-12 via codebase analysis*
