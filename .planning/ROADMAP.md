# Roadmap: Aquarius Lawyers Chatbot — Lifecycle Email Flow + Re-engagement (v1.1)

**Milestone:** Lifecycle email flow + abandonment re-engagement + firm daily digest
**Core Value:** Every visitor who shows intent gets a humane chance to convert; every paying client reaches a complete handoff to the firm; the firm sees one coherent morning summary instead of inbox noise.
**Granularity:** Coarse (3 phases, ~2-3 days of focused work)
**Coverage:** 24/24 v1.1 requirements mapped
**Phase numbering:** Continues from v1.0 (last phase = 3); v1.1 phases are 4, 5, 6.

---

## Phases

- [ ] **Phase 4: Re-engagement Framework + Payment Abandonment** — Generalised reminder module, two-key idempotency, HMAC unsubscribe, payment-abandonment email pair (1h hybrid + 24h follow-up), scheduling at intake, cancellation on payment-success
- [ ] **Phase 5: Appointment Abandonment** — Appointment-abandonment email (4h + 24h variants), scheduling at upload-success (non-urgent only), cancellation on Calendly booking, integration test for cancel race
- [ ] **Phase 6: Firm Daily Digest + Happy-Path Audit** — Activity log, daily aggregator, 9am AEST QStash cron, digest email template, audit + diagram-alignment pass on five existing happy-path emails

---

## Phase Details

### Phase 4: Re-engagement Framework + Payment Abandonment

**Goal**: A reusable email-reminder framework exists, the payment-abandonment flow is live end-to-end, and the unsubscribe mechanism works — including the two-key idempotency pattern and absent-safe degradation that v1.0 proved out for SMS.

**Depends on**: v1.0 Phase 1 (`src/lib/sms/copy.ts` DCEM pattern), v1.0 Phase 2 (`@upstash/qstash` install, `verifySignatureAppRouter` usage). Both already shipped.

**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, INFRA-06, INFRA-07, PAY-01, PAY-02, PAY-03, PAY-04, OPS-V1.1-01, OPS-V1.1-02, TEST-V1.1-01

**New files**:
- `src/lib/email-reminders/dispatch.ts` — `scheduleEmailReminder()`, `cancelEmailReminder()`, delivery handler
- `src/lib/email-reminders/state.ts` — Redis helpers for `email-reminder:{type}:{sessionId}` (cancel-lookup) and `email-reminder-sent:{type}:{sessionId}` (delivery NX) and per-session `*-completed:{sessionId}` keys
- `src/lib/email-reminders/copy.ts` — locked copy strings for payment-1h hybrid template + payment-24h template + LSS-options explainer block (DCEM-classification comment)
- `src/lib/email-reminders/unsubscribe.ts` — HMAC sign + verify using `EMAIL_REMINDER_UNSUBSCRIBE_SECRET`
- `src/app/api/webhooks/email-reminder/route.ts` — QStash delivery target with signature verification + delivery-time cancel/unsub gate
- `src/app/api/email/unsubscribe/route.ts` — one-click unsubscribe endpoint
- `src/lib/email/templates/reengagement-payment.tsx` — single React Email template that renders both 1h hybrid and 24h variants by prop
- `src/lib/email-reminders/__tests__/dispatch.test.ts` — unit tests for schedule, cancel, NX dedup, unsubscribe HMAC, absent-env graceful degradation

**Mutates existing files**:
- `src/lib/tools/select-urgency.ts` — add 2x `scheduleEmailReminder()` calls after `sendClientInquiryEmail`/`sendFirmLeadEmail` succeed (failure-isolated; reminder failure must not propagate up)
- `src/lib/intake/handle-paid.ts` — add 2x `cancelEmailReminder('payment-abandonment-1h' | '-24h', ...)` calls + write `payment-completed:{sessionId}` Redis key

**Success Criteria** (what must be TRUE):
  1. A unit test calling `scheduleEmailReminder()` with `QSTASH_TOKEN` absent logs a structured warning and makes zero network calls — same shape as v1.0 SMS.
  2. After `scheduleEmailReminder('payment-abandonment-1h', sessionId, 3600)` succeeds, Redis key `email-reminder:payment-abandonment-1h:{sessionId}` exists with a QStash messageId value and TTL ≈ 3h.
  3. A POST to `/api/webhooks/email-reminder` without a valid QStash signature returns non-200; the handler never reaches the cancellation/unsubscribe gate or Resend dispatch.
  4. A POST to `/api/webhooks/email-reminder` with valid signature, but where `payment-completed:{sessionId}` exists OR `unsubscribe:{sessionId}` exists, returns `"skipped"` and emits `email_reminder_skipped` log — no Resend call is made.
  5. `cancelEmailReminder('payment-abandonment-1h', sessionId)` called twice (idempotent) — first call cancels QStash + clears Redis key; second call is a no-op without throwing.
  6. A unit test of unsubscribe-link verification: a token signed with the wrong secret OR for a different sessionId is rejected with non-200; a correctly signed token sets `unsubscribe:{sessionId}` Redis key.
  7. End-to-end manual test: complete intake on staging → wait 1h → 1h hybrid email arrives with Aquarius logo, payment-resume link works, LSS explainer block is visible, unsubscribe link resolves to confirmation page; `email-reminder-sent:payment-abandonment-1h:{sessionId}` Redis key now exists with TTL ≈ 7d.

**Plans**: TBD (typically 2 — Wave 0 RED test stubs + Wave 1 GREEN implementation)

---

### Phase 5: Appointment Abandonment

**Goal**: Non-urgent visitors who pay + upload but don't book a Calendly slot receive a 4h prefilled-link nudge and a 24h follow-up — both cancelled instantly when they book. Urgent visitors are never scheduled. The framework from Phase 4 is reused without modification.

**Depends on**: Phase 4 (uses `scheduleEmailReminder`, `cancelEmailReminder`, the email-reminder webhook, and the unsubscribe gate)

**Requirements**: APT-01, APT-02, APT-03, TEST-V1.1-02

**New files**:
- `src/lib/email/templates/reengagement-appointment.tsx` — single React Email template that renders both 4h and 24h variants by `delay` prop
- `src/lib/email-reminders/__tests__/appointment.test.ts` — integration test simulating Calendly booking before reminder fires

**Mutates existing files**:
- `src/lib/late-upload/handle-completed.ts` — add `scheduleEmailReminder('appointment-abandonment-4h' | '-24h', ...)` calls when intake `urgency === "non-urgent"` (gate explicit; never schedule for urgent)
- `src/app/api/webhooks/calendly/route.ts` — add 2x `cancelEmailReminder('appointment-abandonment-*', ...)` calls + write `booked:{sessionId}` Redis key
- `src/lib/email-reminders/copy.ts` — add appointment-4h and appointment-24h locked copy strings

**Success Criteria** (what must be TRUE):
  1. After a non-urgent late-upload completion, Redis keys `email-reminder:appointment-abandonment-4h:{sessionId}` and `email-reminder:appointment-abandonment-24h:{sessionId}` both exist.
  2. After an urgent late-upload completion, neither appointment-abandonment Redis key exists — verified by integration test asserting zero scheduling calls reach QStash for urgent intakes.
  3. After a Calendly `invitee.created` webhook, both appointment-abandonment reminders are cancelled and `booked:{sessionId}` Redis key exists.
  4. The integration test simulates: non-urgent flow → upload completes → schedule both appointment reminders → simulate Calendly book at T+3h → both QStash jobs cancelled. If QStash still delivers (race), the delivery handler reads `booked:{sessionId}` and short-circuits with `email_reminder_skipped`.
  5. The 4h appointment-abandonment email renders the prefilled Calendly URL with visitor name + email properly URL-encoded; clicking arrives at a Calendly slot picker (not a generic page).

**Plans**: TBD (typically 1 — most of the framework is from Phase 4)

---

### Phase 6: Firm Daily Digest + Happy-Path Audit

**Goal**: The firm receives one coherent 9am AEST email summarising the previous 24h of activity, suppressed on quiet days. The five existing happy-path emails are audited against the lifecycle diagram and any gaps fixed inline.

**Depends on**: Phase 4 (email-reminder webhook signature pattern is reused for the cron webhook). Independent of Phase 5.

**Requirements**: DIG-01, DIG-02, DIG-03, DIG-04, DIG-05, DIG-06

**New files**:
- `src/lib/digest/aggregate.ts` — `aggregateActivity(fromIso, toIso)` reads Redis activity list, groups by event type, returns structured summary
- `src/lib/digest/activity-log.ts` — `logActivity(event, sessionId, payload)` appends JSON to Redis list `activity:{YYYY-MM-DD-AEST}` with 14d TTL
- `src/app/api/cron/daily-digest/route.ts` — QStash cron target; reads previous 24h, calls aggregator, sends digest email if non-empty
- `src/lib/email/templates/firm-daily-digest.tsx` — React Email template with conditional sections
- `src/lib/digest/__tests__/aggregate.test.ts` — unit tests for grouping, empty-day suppression, 24h timestamp window
- `scripts/setup-daily-digest-cron.ts` — one-shot script to publish the QStash cron schedule (or document the manual setup in README)

**Mutates existing files**:
- `src/lib/tools/select-urgency.ts` — add `logActivity('lead_created', ...)` call
- `src/lib/intake/handle-paid.ts` — add `logActivity('payment_completed', ...)` call
- `src/lib/late-upload/handle-completed.ts` — add `logActivity('upload_completed', ...)` call
- `src/app/api/webhooks/calendly/route.ts` — add `logActivity('appointment_booked', ...)` call
- `src/lib/email-reminders/dispatch.ts` (delivery handler) — add `logActivity('payment_abandoned_1h' | '_24h' | 'appointment_abandoned_4h' | '_24h', ...)` calls when reminder actually sends (not when skipped)
- `src/app/api/email/unsubscribe/route.ts` — add `logActivity('unsubscribed', ...)` call
- The five existing happy-path templates: any audit-surfaced fixes (likely small — e.g. ensuring matter description is present, fee formatting, etc.)

**Success Criteria** (what must be TRUE):
  1. After 5 mock events spanning 24h, calling `aggregateActivity()` returns counts matching the events: e.g. 2 leads, 1 payment, 1 booking, 1 abandonment.
  2. A digest run on a quiet day (zero activity) emits `digest_skipped_empty` log and makes zero Resend calls.
  3. A digest run on a busy day produces an email with sections for each non-empty category; sections with zero activity are entirely absent (not rendered as "0 events").
  4. The QStash cron runs at 9am AEST (15:00 UTC during AEST or 14:00 UTC during AEDT — verify with timezone-aware scheduling).
  5. The audit pass produces a written checklist (in the phase plan or a follow-up todo) confirming each of the five existing happy-path emails matches the diagram. Any inline fixes are commit-traceable.

**Plans**: TBD (typically 2 — activity log + aggregator first, then digest template + cron + audit)

---

## Progress

| Phase | Plans Complete | Status | Started | Completed |
|-------|----------------|--------|---------|-----------|
| 4. Re-engagement Framework + Payment | 0/? | Not started | — | — |
| 5. Appointment Abandonment | 0/? | Not started | — | — |
| 6. Firm Digest + Happy-Path Audit | 0/? | Not started | — | — |

---

## Coverage

All 24 v1.1 requirements mapped. No orphans.

| Requirement | Phase |
|-------------|-------|
| INFRA-01 | 4 |
| INFRA-02 | 4 |
| INFRA-03 | 4 |
| INFRA-04 | 4 |
| INFRA-05 | 4 |
| INFRA-06 | 4 |
| INFRA-07 | 4 |
| PAY-01 | 4 |
| PAY-02 | 4 |
| PAY-03 | 4 |
| PAY-04 | 4 |
| APT-01 | 5 |
| APT-02 | 5 |
| APT-03 | 5 |
| DIG-01 | 6 |
| DIG-02 | 6 |
| DIG-03 | 6 |
| DIG-04 | 6 |
| DIG-05 | 6 |
| DIG-06 | 6 |
| OPS-V1.1-01 | 4 |
| OPS-V1.1-02 | 4 |
| TEST-V1.1-01 | 4 |
| TEST-V1.1-02 | 5 |

---

*Roadmap created: 2026-05-07*
*Phases continue numbering from v1.0 (last phase = 3); v1.1 starts at 4.*
