# Requirements: Aquarius Lawyers Chatbot — Lifecycle Email Flow + Re-engagement (v1.1)

**Defined:** 2026-05-07
**Core Value:** Every visitor who shows intent gets a humane chance to convert; every paying client reaches a complete handoff to the firm; the firm sees one coherent morning summary instead of inbox noise.

## v1.1 Requirements

### Re-engagement Framework (INFRA)

- [ ] **INFRA-01**: A generalised email-reminder module (`src/lib/email-reminders/`) exposes `scheduleEmailReminder(type, sessionId, delaySeconds, payload)`, `cancelEmailReminder(type, sessionId)`, and a delivery-handler that the QStash webhook calls — module is independent of any specific reminder type
- [ ] **INFRA-02**: `scheduleEmailReminder()` publishes a QStash delayed job and stores the QStash messageId in Redis at `email-reminder:{type}:{sessionId}` with TTL = `delaySeconds + 7200` (2h grace)
- [ ] **INFRA-03**: The reminder webhook (`/api/webhooks/email-reminder`) verifies QStash signatures via `verifySignatureAppRouter` and refuses unsigned requests with non-200
- [ ] **INFRA-04**: Before sending, the delivery handler reads the cancellation state key (e.g. `payment-completed:{sessionId}`) AND the per-session `unsubscribe:{sessionId}` key — short-circuits with structured `email_reminder_skipped` log if either is set
- [ ] **INFRA-05**: A delivery NX key `email-reminder-sent:{type}:{sessionId}` (TTL 7d) prevents duplicate sends if QStash redelivers or a cancel races with delivery — write happens AFTER successful Resend send returns
- [ ] **INFRA-06**: `cancelEmailReminder()` reads the stored QStash messageId, calls `client.messages.cancel()`, and clears the `email-reminder:{type}:{sessionId}` Redis key — idempotent (safe to call when no scheduled job exists)
- [ ] **INFRA-07**: An HMAC-signed one-click unsubscribe endpoint (`GET /api/email/unsubscribe?session={id}&token={hmac}`) verifies the token using `EMAIL_REMINDER_UNSUBSCRIBE_SECRET`, sets `unsubscribe:{sessionId}` Redis key, cancels all pending v1.1 reminders for that session, and returns a confirmation page

### Payment Abandonment (PAY)

- [ ] **PAY-01**: When the `selectUrgency` tool successfully records the visitor's intake, `scheduleEmailReminder('payment-abandonment-1h', ...)` and `scheduleEmailReminder('payment-abandonment-24h', ...)` are both called — failure to schedule must NOT prevent the inquiry email from sending
- [ ] **PAY-02**: On successful payment in `handlePaid`, both payment-abandonment reminders are cancelled via `cancelEmailReminder()` and `payment-completed:{sessionId}` Redis key is set with TTL of 26h
- [ ] **PAY-03**: The 1h payment-abandonment email template renders a hybrid body: gentle nudge ("you're nearly done") + a short LSS-options explainer block (urgent vs non-urgent, what's included in each tier) + payment-resume link + transcript reference + one-click unsubscribe link + standard footer
- [ ] **PAY-04**: The 24h payment-abandonment email template renders a follow-up nudge: payment-resume link + brief reminder of the matter description + one-click unsubscribe link + standard footer (no LSS explainer — already shown at 1h)

### Appointment Abandonment (APT)

- [ ] **APT-01**: On non-urgent upload-success (`handleLateUploadCompleted` or equivalent), `scheduleEmailReminder('appointment-abandonment-4h', ...)` and `scheduleEmailReminder('appointment-abandonment-24h', ...)` are both called — urgent visitors are skipped (verified by checking intake `urgency` field)
- [ ] **APT-02**: On Calendly booking-confirmation webhook, both appointment-abandonment reminders are cancelled and `booked:{sessionId}` Redis key is set with TTL of 26h
- [ ] **APT-03**: The 4h and 24h appointment-abandonment email templates render: prefilled Calendly link (using stored visitor name + email) + matter description + one-click unsubscribe link + standard footer — same template, variant copy by `delay` parameter

### Firm Daily Digest (DIG)

- [ ] **DIG-01**: An activity log captures every lifecycle event (`lead_created`, `payment_completed`, `upload_completed`, `appointment_booked`, `payment_abandoned_1h`, `payment_abandoned_24h`, `appointment_abandoned_4h`, `appointment_abandoned_24h`, `unsubscribed`) by appending a JSON entry to a Redis list keyed `activity:{YYYY-MM-DD-AEST}` with a 14-day TTL
- [ ] **DIG-02**: A QStash daily cron publishes a job at 9am AEST every day, targeting `/api/cron/daily-digest` — signature-verified
- [ ] **DIG-03**: The digest aggregator reads the previous 24h of activity entries (timestamp-based read, NOT "since last digest"), groups by event type, and returns counts + per-session summaries
- [ ] **DIG-04**: The firm-daily-digest email template renders sections: New leads, Payments completed, Documents uploaded, Appointments booked, Abandonments (with stage breakdown), Unsubscribes — each section omitted entirely if empty
- [ ] **DIG-05**: The digest is suppressed (no email sent) if all sections are empty for the previous 24h — logged as `digest_skipped_empty`
- [ ] **DIG-06**: The audit pass on existing five happy-path emails ([client-inquiry](src/lib/email/templates/client-inquiry.tsx), [firm-lead](src/lib/email/templates/firm-lead.tsx), [payment-receipt](src/lib/email/payment-receipt.tsx), [firm-transcript](src/lib/email/templates/firm-transcript.tsx), [firm-booking-notification](src/lib/email/templates/firm-booking-notification.tsx)) confirms each email's content matches the lifecycle diagram — any diagram-implied gap is fixed inline; any pre-existing bug is filed as a separate todo

### Operations (OPS)

- [ ] **OPS-V1.1-01**: App boots and all flows function when `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, or `EMAIL_REMINDER_UNSUBSCRIBE_SECRET` are missing — schedule/cancel/unsubscribe call sites log a structured warning and return without throwing
- [ ] **OPS-V1.1-02**: Every reminder dispatch attempt emits a structured log line (`email_reminder_sent`, `email_reminder_skipped`, `email_reminder_failed`) including `type`, `sessionId`, outcome, and Resend message ID where available — same structured-logging discipline as v1.0 SMS

### Testing (TEST)

- [ ] **TEST-V1.1-01**: Unit tests cover `scheduleEmailReminder`, `cancelEmailReminder`, two-key idempotency (cancel-lookup + delivery NX), unsubscribe HMAC verification, and absent-env graceful degradation — without hitting real QStash or Resend (mock both)
- [ ] **TEST-V1.1-02**: Integration test simulates a visitor completing payment within the 1h window after intake — asserts both payment-abandonment reminders are cancelled and the delivery handler short-circuits if QStash redelivers anyway

## v2 Requirements

Deferred. Tracked for a future milestone.

### Channel Expansion

- **CH-V2-01**: Visitor preference: choose SMS or email per stage (requires preference UI + storage)
- **CH-V2-02**: Inbound reply handling for unsubscribe (separate from one-click)
- **CH-V2-03**: Email reminder for doc upload (currently SMS-only via v1.0; revisit if SMS deliverability proves unreliable)

### Digest Enhancements

- **DIG-V2-01**: Per-firm-user digest preferences (e.g. only-urgent, only-high-value)
- **DIG-V2-02**: Digest covers conversion-rate metrics over the last 7d / 30d
- **DIG-V2-03**: Digest links each lead to its Smokeball matter URL

### Re-engagement Enhancements

- **REENG-V2-01**: Third escalation touchpoint at 72h for payment abandonment (currently 2 touches)
- **REENG-V2-02**: Custom unsubscribe page with reason capture for product feedback

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| v1.0 Phase 3 (provider-agnostic seam) | Deferred to a future milestone; v1.1 hooks into existing seams directly |
| Doc-upload email reminder | v1.0 SMS already covers this at 24h; adding email triples the nudge volume |
| Per-event firm alert for payment / appointment abandonment | Replaced by daily digest; firm acts on the digest, not pings |
| Pushing pre-payment abandonment leads to Smokeball | Keeps Smokeball clean as a paid-leads system of record |
| Inbound email reply handling for unsubscribe | One-click is sufficient; matches v1.0 SMS one-way stance |
| Behavioural change to existing five happy-path emails | Audited only; behaviour stays unless audit finds a bug |
| Business-hour deferral for sends | Calendly enforces slot validity; visitor reads on their schedule |
| Visitor channel preference (SMS vs email) | Channel-per-stage is fixed by design; revisit in v2 |
| Third escalation touchpoint per stage | 2 touches is the locked cadence; 3+ crosses into pestering |
| Stripe → Bpoint payment provider migration | Tracked separately in a parallel worktree |
| Rebuilding the fragmented Redis session model | Tech debt flagged in `.planning/codebase/CONCERNS.md`; out of scope |
| Retroactive test coverage for pre-v1.0 code | Scope containment; v1.1 tests cover v1.1 code only |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 4 | Pending |
| INFRA-02 | Phase 4 | Pending |
| INFRA-03 | Phase 4 | Pending |
| INFRA-04 | Phase 4 | Pending |
| INFRA-05 | Phase 4 | Pending |
| INFRA-06 | Phase 4 | Pending |
| INFRA-07 | Phase 4 | Pending |
| PAY-01 | Phase 4 | Pending |
| PAY-02 | Phase 4 | Pending |
| PAY-03 | Phase 4 | Pending |
| PAY-04 | Phase 4 | Pending |
| APT-01 | Phase 5 | Pending |
| APT-02 | Phase 5 | Pending |
| APT-03 | Phase 5 | Pending |
| DIG-01 | Phase 6 | Pending |
| DIG-02 | Phase 6 | Pending |
| DIG-03 | Phase 6 | Pending |
| DIG-04 | Phase 6 | Pending |
| DIG-05 | Phase 6 | Pending |
| DIG-06 | Phase 6 | Pending |
| OPS-V1.1-01 | Phase 4 | Pending |
| OPS-V1.1-02 | Phase 4 | Pending |
| TEST-V1.1-01 | Phase 4 | Pending |
| TEST-V1.1-02 | Phase 5 | Pending |

**Coverage:**
- v1.1 requirements: 24 total (corrected — INFRA expanded slightly during drafting)
- Mapped to phases: 24
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-07*
*Last updated: 2026-05-07 after initial definition*
