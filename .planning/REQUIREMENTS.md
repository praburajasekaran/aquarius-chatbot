# Requirements: Aquarius Lawyers Chatbot — ClickSend SMS Integration

**Defined:** 2026-04-24
**Core Value:** Paying clients reliably get their documents to the firm — because their mobile buzzed, not because they happened to check an email.

## v1 Requirements

### Dispatch

- [ ] **SMS-01**: Client receives an SMS immediately on payment-success containing the upload link
- [x] **SMS-02**: SMS dispatch module (`src/lib/sms/`) accepts a provider-agnostic `IntakePaidEvent`, never a Stripe- or Bpoint-specific payload
- [x] **SMS-03**: All outbound numbers are normalised to E.164 (`+61…`) via `libphonenumber-js/min` before hitting ClickSend
- [x] **SMS-04**: Landline-format phone numbers are silently skipped with a structured log event (`sms_skipped`, reason=`landline`), and never hit the ClickSend API
- [ ] **SMS-05**: `sms-immediate:{sessionId}` Redis NX key prevents duplicate immediate sends on webhook retry

### Scheduler

- [x] **SCHED-01**: A QStash delayed job is published at payment-success time with `delay: 86400` (24 hours), targeting the SMS-reminder webhook
- [x] **SCHED-02**: The reminder webhook verifies QStash signatures (`verifySignatureAppRouter`) and refuses unsigned requests
- [x] **SCHED-03**: Before sending the reminder, the handler reads the authoritative upload state (upload-token or session `uploadRefs`) and short-circuits if the client already uploaded
- [x] **SCHED-04**: On successful upload, the pending reminder is cancelled via `client.messages.cancel(messageId)`; the `messageId` is stored in Redis at scheduling time under `sms-reminder:{sessionId}` with a 26h TTL
- [x] **SCHED-05**: `sms-reminder:{sessionId}` Redis NX key prevents duplicate reminder sends if QStash delivers more than once or the cancel races with delivery

### Provider-Agnostic Seam

- [ ] **EVENT-01**: A single `handleIntakePaid(event: IntakePaidEvent)` function is the only entry point that fans out to SMS, email, and any downstream integrations
- [ ] **EVENT-02**: The existing payment webhook handler is refactored to call `handleIntakePaid()` after validating and deduplicating its provider-specific payload (Stripe → BPoint migration in progress; the seam is provider-agnostic)
- [ ] **EVENT-03**: The `IntakePaidEvent` shape contains only the fields both Stripe and Bpoint webhooks can supply: `sessionId`, `clientName`, `clientEmail`, `clientPhone`, `paidAt`, `amountCents`, `uploadLink`

### Compliance

- [x] **COMP-01**: SMS body copy is defined as a locked named constant in `src/lib/sms/copy.ts` with a DCEM-classification comment warning against promotional edits
- [x] **COMP-02**: Copy contains the firm's identifying name and a human-readable contact phone for opt-out — and does NOT contain "Reply STOP" (incompatible with one-way alpha-tag sender IDs)
- [ ] **COMP-03**: The sender ID is read from `CLICKSEND_SENDER_ID` env var at dispatch time; registration of that sender ID with ACMA via ClickSend is tracked as an operational task outside code

### Operations

- [ ] **OPS-01**: App boots and all existing flows function when `CLICKSEND_USERNAME`, `CLICKSEND_API_KEY`, `CLICKSEND_SENDER_ID`, or `QSTASH_*` env vars are missing — `sendSms()` and `scheduleReminderSms()` log a structured warning and return without throwing
- [ ] **OPS-02**: Every dispatch attempt emits a structured log line (`sms_sent`, `sms_skipped`, `sms_failed`) including `sessionId`, outcome, and ClickSend message ID where available
- [x] **OPS-03**: ClickSend API credentials are never logged; the E.164 phone number is logged only as the last-4-digits-masked form (e.g. `+61*****6789`)

### Testing

- [x] **TEST-01**: Unit tests cover E.164 normalisation, landline detection, and absent-env graceful degradation without hitting the real ClickSend API (mock `fetch`)
- [ ] **TEST-02**: Integration test simulates a Stripe webhook retry and asserts exactly one immediate SMS is dispatched
- [ ] **TEST-03**: Integration test simulates a client uploading before the 24h reminder fires and asserts the reminder is cancelled (or at minimum skipped by the upload-state check)

### Knowledge Base Reporting

- [ ] **REPORT-01**: When `matchQuestion` returns no match, the normalized question text is stored in a Redis sorted set `unanswered:{YYYY-MM}` with the current timestamp as score
- [ ] **REPORT-02**: A Vercel Cron job triggers monthly (1st of month, midnight UTC) to compile and email the unanswered questions report
- [ ] **REPORT-03**: The report email lists all unique unanswered questions from the prior month, rendered via a React email template
- [ ] **REPORT-04**: Question storage degrades gracefully — if Redis is unavailable, `matchQuestion` continues to return the fallback response without error
- [ ] **REPORT-05**: Duplicate questions (normalized text match) within a month update the timestamp but do not create duplicate entries in the sorted set

## v2 Requirements

Deferred. Tracked for a future milestone.

### Dispatch-v2

- **SMS-V2-01**: ClickSend delivery-receipt (DLR) webhook updates a per-session delivery status in Redis
- **SMS-V2-02**: ClickSend `shorten_urls` enabled once the firm's upload domain has been approved by ClickSend support
- **SMS-V2-03**: First-name personalisation in SMS greeting (trivial, but v2 to keep the initial DCEM-safe copy locked)

### Channel Expansion

- **EXT-V2-01**: Firm new-lead SMS alert on payment-success
- **EXT-V2-02**: Calendly booking-confirmation SMS
- **EXT-V2-03**: Inbound SMS routing (reply handling)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Stripe → Bpoint payment provider migration | Happening in a parallel worktree; this milestone depends on a provider-agnostic trigger but does not do the migration |
| Two-way SMS / inbound reply inbox | Alpha-tag sender IDs are one-way; STOP delegated to ClickSend's opt-out list; building a reply inbox is a separate initiative |
| Firm new-lead SMS (immediate) | Firm already gets email; client-facing SMS is the value driver this milestone |
| Calendly booking SMS reminder | Different trigger, different copy, different consent framing — decide separately after upload-nudge proves out |
| Retroactive test coverage for existing code | This milestone adds tests for new SMS code only; filling legacy coverage is a separate initiative |
| Rebuilding the fragmented Redis session model | Flagged as tech debt in CONCERNS.md; addressing it now would blow the 1-day budget |
| SMS marketing / promotional messages | Regulatory red line — DCEM classification would be lost, breaking Spam Act safe harbour |
| Alpha-tag ACMA Sender ID registration (the registration itself) | Operational task done outside code; the code consumes the registered ID via env var |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SMS-02 | Phase 1 | Complete |
| SMS-03 | Phase 1 | Complete |
| SMS-04 | Phase 1 | Complete |
| COMP-01 | Phase 1 | Complete |
| COMP-02 | Phase 1 | Complete |
| OPS-03 | Phase 1 | Complete |
| TEST-01 | Phase 1 | Complete |
| SCHED-01 | Phase 2 | Complete |
| SCHED-02 | Phase 2 | Complete |
| SCHED-03 | Phase 2 | Complete |
| SCHED-04 | Phase 2 | Complete |
| SCHED-05 | Phase 2 | Complete |
| EVENT-01 | Phase 3 | Pending |
| EVENT-02 | Phase 3 | Pending |
| EVENT-03 | Phase 3 | Pending |
| SMS-01 | Phase 3 | Pending |
| SMS-05 | Phase 3 | Pending |
| COMP-03 | Phase 3 | Pending |
| OPS-01 | Phase 3 | Pending |
| OPS-02 | Phase 3 | Pending |
| TEST-02 | Phase 3 | Pending |
| TEST-03 | Phase 3 | Pending |
| REPORT-01 | Phase 4 | Pending |
| REPORT-02 | Phase 4 | Pending |
| REPORT-03 | Phase 4 | Pending |
| REPORT-04 | Phase 4 | Pending |
| REPORT-05 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 27 total
- Mapped to phases: 27
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-24*
*Last updated: 2026-04-24 after initial definition*
