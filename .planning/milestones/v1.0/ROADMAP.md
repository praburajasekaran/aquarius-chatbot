# Roadmap: Aquarius Lawyers Chatbot — ClickSend SMS Integration

**Milestone:** ClickSend SMS nudges for post-payment document-upload flow
**Core Value:** Paying clients reliably get their documents to the firm — because their mobile buzzed, not because they happened to check an email.
**Granularity:** Coarse (3 phases, ~1-day feature)
**Coverage:** 22/22 v1 requirements mapped

---

## Phases

- [x] **Phase 1: Dispatch Foundation** - Isolated SMS module: E.164 normalisation, landline detection, ClickSend client, compliance copy, unit tests — no existing files touched *(completed 2026-04-27)*
- [x] **Phase 2: QStash Scheduler** - 24h delayed reminder: schedule on payment, signature-verified delivery webhook, upload-gate cancellation hook *(completed 2026-04-27)*
- [ ] **Phase 3: Provider-Agnostic Seam** - Wire everything into the app: `handleIntakePaid()` orchestrator, Stripe webhook refactor, upload-route cancel hooks, integration tests

---

## Phase Details

### Phase 1: Dispatch Foundation
**Goal**: The SMS dispatch module exists as a fully-tested, independently-mergeable library that can send or skip an immediate SMS given an E.164 phone number — with no touch to any existing file.
**Depends on**: Nothing (first phase; all files are new)
**Requirements**: SMS-02, SMS-03, SMS-04, COMP-01, COMP-02, OPS-03, TEST-01
**New files**:
- `src/lib/sms/dispatch.ts` — ClickSend fetch client, `toE164AU()`, `isLandline()`, `sendSms()`
- `src/lib/sms/copy.ts` — `immediateCopy()` and `reminderCopy()` as locked named constants with DCEM compliance comment
- `src/lib/sms/__tests__/dispatch.test.ts` — unit tests with mocked `fetch`
**Success Criteria** (what must be TRUE):
  1. A unit test calling `sendSms()` with `CLICKSEND_*` env vars absent logs a structured warning and makes zero `fetch` calls.
  2. `toE164AU("0412 345 678")` returns `+61412345678`; `toE164AU("+61412345678")` returns the same value (idempotent); both assertions pass in the test suite.
  3. A number starting with `02`, `03`, `07`, or `08` is detected as a landline and emits a structured log event with `reason: "landline"` — verified by the unit test asserting `fetch` is never called.
  4. The SMS copy constant in `copy.ts` contains the firm name, the upload link placeholder, and a DCEM classification comment — and does NOT contain "Reply STOP" (alpha-tag incompatibility).
  5. Phone numbers are logged in masked form only (`+61*****XXXX`); the raw E.164 number never appears in any log output — verified by unit test spy on `console.info`.
**Plans**: 2 plans
  - [x] 01-01-PLAN.md — Wave 0: Vitest infra + 6 failing test stubs (RED)
  - [x] 01-02-PLAN.md — Wave 1: copy.ts and dispatch.ts implementation (GREEN)

### Phase 2: QStash Scheduler
**Goal**: A cancellable 24h SMS reminder is scheduled at payment time and delivered exactly once — skipped if the client already uploaded, and cancelled when they upload before the window closes.
**Depends on**: Phase 1 (uses `sendSms()` and `reminderCopy()` from `src/lib/sms/`)
**Requirements**: SCHED-01, SCHED-02, SCHED-03, SCHED-04, SCHED-05
**New files**:
- `src/lib/sms/reminder.ts` — `scheduleReminderSms()`, `cancelPendingReminder()`, QStash client
- `src/app/api/webhooks/sms-reminder/route.ts` — QStash delivery target, signature verification, upload-state gate
**Success Criteria** (what must be TRUE):
  1. `scheduleReminderSms()` called with missing `QSTASH_TOKEN` logs a structured warning and returns without throwing — the app does not break.
  2. After `scheduleReminderSms()` succeeds, a Redis key `sms-reminder:{sessionId}` exists with a QStash message ID value and a TTL of approximately 26 hours.
  3. A POST to `/api/webhooks/sms-reminder` without a valid QStash signature returns a non-200 response — the handler never reaches the upload-state check or SMS dispatch.
  4. A POST to `/api/webhooks/sms-reminder` with a valid signature and a session whose `uploadRefs` is non-empty returns `"skipped"` — no ClickSend API call is made.
  5. `cancelPendingReminder(sessionId)` reads the stored QStash message ID from Redis and calls `client.messages.cancel()` — verified by unit test with mocked QStash client.
**Plans**: 2 plans
  - [x] 02-01-PLAN.md — Wave 0: install @upstash/qstash + 5 failing test stubs (RED) *(completed 2026-04-27)*
  - [x] 02-02-PLAN.md — Wave 1: reminder.ts + sms-reminder route.ts implementation (GREEN) *(completed 2026-04-27)*

### Phase 3: Provider-Agnostic Seam
**Goal**: The SMS feature is live end-to-end: payment success triggers immediate SMS and schedules the reminder, document upload cancels the reminder, and the Stripe webhook no longer contains any inline fan-out logic — all via a single `handleIntakePaid()` entry point that neither Stripe nor Bpoint types can leak through.
**Depends on**: Phase 1, Phase 2
**Requirements**: EVENT-01, EVENT-02, EVENT-03, SMS-01, SMS-05, COMP-03, OPS-01, OPS-02, TEST-02, TEST-03
**Mutates existing files**:
- `src/app/api/webhooks/stripe/route.ts` — replace inline fan-out with `handleIntakePaid()` call
- `src/app/api/late-upload/session/route.ts` — add `cancelPendingReminder()` call on successful upload
- `src/app/api/upload/route.ts` (if it exists) — add `cancelPendingReminder()` call
**New files**:
- `src/lib/intake-paid.ts` — `handleIntakePaid(event: IntakePaidEvent)` orchestrator
- `src/types/index.ts` additions — `IntakePaidEvent` interface
- `src/lib/sms/__tests__/reminder.test.ts` — integration tests for retry dedup and upload-gate cancel
**Success Criteria** (what must be TRUE):
  1. An SMS arrives on a test AU mobile number within 30 seconds of a simulated payment-success event fired through `handleIntakePaid()` in a staging environment with `CLICKSEND_*` vars set.
  2. A simulated Stripe webhook retry (second POST of the same `checkout.session.completed` event) results in exactly one SMS send — verified by the Redis `sms-immediate:{sessionId}` NX key guard and the integration test asserting a single `fetch` call.
  3. `src/lib/sms/dispatch.ts` contains zero imports from the Stripe SDK — `grep -r "from 'stripe'" src/lib/sms/` returns no matches.
  4. The app boots and all non-SMS flows (chat, payment, email, upload) operate correctly when `CLICKSEND_USERNAME`, `CLICKSEND_API_KEY`, `CLICKSEND_SENDER_ID`, and `QSTASH_TOKEN` are all absent from the environment.
  5. An integration test simulating a client uploading before the 24h window results in `cancelPendingReminder()` being called and the reminder handler returning `"skipped"` rather than dispatching a second SMS.
**Plans**: TBD

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Dispatch Foundation | 2/2 | Complete | 2026-04-27 |
| 2. QStash Scheduler | 2/2 | Complete | 2026-04-27 |
| 3. Provider-Agnostic Seam | 0/1 | Not started | - |

---

## Coverage

All 22 v1 requirements mapped. No orphans.

| Requirement | Phase |
|-------------|-------|
| SMS-02 | 1 |
| SMS-03 | 1 |
| SMS-04 | 1 |
| COMP-01 | 1 |
| COMP-02 | 1 |
| OPS-03 | 1 |
| TEST-01 | 1 |
| SCHED-01 | 2 |
| SCHED-02 | 2 |
| SCHED-03 | 2 |
| SCHED-04 | 2 |
| SCHED-05 | 2 |
| EVENT-01 | 3 |
| EVENT-02 | 3 |
| EVENT-03 | 3 |
| SMS-01 | 3 |
| SMS-05 | 3 |
| COMP-03 | 3 |
| OPS-01 | 3 |
| OPS-02 | 3 |
| TEST-02 | 3 |
| TEST-03 | 3 |

---

*Roadmap created: 2026-04-24*
*Last updated: 2026-04-27 after completing phase 02 (qstash-scheduler — 5/5 tests GREEN, SCHED-01–05 verified)*
