# Plan: Smokeball Zapier Paid Intake Integration

> Created: 2026-05-22
> Status: completed
> Trigger: Implement handoff for Smokeball/Zapier integration after paid intakes

## Goal & Success Criteria
- **Goal**: Create Smokeball matters after paid intakes and attach Calendly appointment notes once a Smokeball matter mapping exists.
- **Done when**: Paid fan-out posts a create-matter Zap payload without transcript data, Calendly posts an appointment-note Zap after a short mapping wait, hard failures email the firm, docs describe the Zaps, and focused tests pass.
- **Non-goals**: Direct Smokeball API integration, AI-generated matter titles, long-running create-matter retries, or changing the existing tail callback contract.

## Current State
- `src/lib/intake/handle-paid.ts` marks paid sessions, mints upload tokens, sends receipt/transcript emails, SMS, reminders, and activity logs.
- `src/lib/zapier.ts` already sends webhooks with one immediate retry.
- `src/app/api/webhooks/smokeball-matter-created/route.ts` stores the session-to-Smokeball matter mapping.
- `src/app/api/webhooks/calendly/route.ts` verifies Calendly signatures and emails the firm but does not attach booking notes to Smokeball.
- `.env.example` documents create, attach, audit, dev, and capture-back variables but not the appointment-note Zap.

## Task Breakdown

| # | Task | Files | Size | Depends On |
|---|------|-------|------|------------|
| 1 | Add deterministic Matter Title and create-matter payload builder | `src/lib/smokeball/create-matter.ts` | S | - |
| 2 | Add firm integration alert helper | `src/lib/resend.ts`, email template | S | - |
| 3 | Wire create-matter Zap into paid fan-out after intake load | `src/lib/intake/handle-paid.ts` | S | T1, T2 |
| 4 | Add appointment-note payload/wait/delivery helper | `src/lib/smokeball/appointment-note.ts` | M | T2 |
| 5 | Wire Calendly webhook to send appointment-note Zap after firm notification | `src/app/api/webhooks/calendly/route.ts` | S | T4 |
| 6 | Document Zap/env shape | `.env.example`, `docs/2026-04-23-integration-status.md` | S | T3, T5 |
| 7 | Add focused tests | `tests/*.test.ts` | M | T1-T5 |

## Technical Design
- **Approach**: Keep Zapier as the integration boundary. Paid fan-out builds a flat create-matter payload with `matter_ref=sessionId`, payment audit fields, client/contact details, urgency, Matter Summary, and deterministic Matter Title, then sends it through the existing immediate-retry `sendToZapier`.
- **Approach**: Calendly webhook keeps acknowledging bookings even if Smokeball note delivery fails. It waits briefly for the tail-callback mapping, then posts a booking-only note payload with `smokeball_matter_id`; if no mapping arrives or the Zap fails, the firm receives a manual-follow-up alert.
- **Alternatives rejected**: Durable app retry for create-matter Zap is deferred because duplicate Smokeball matters are worse than a manual alert until Zapier/Smokeball idempotency by Matter Reference is confirmed.
- **Key decisions**: Create-matter uses `ZAPIER_WEBHOOK_URL` to match existing environment naming; appointment notes get a new `ZAPIER_APPOINTMENT_NOTE_WEBHOOK_URL`.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Dev payload reaches production Smokeball | L | H | Preserve top-level `isTest` flag and document dev/prod Zap split |
| Matter title is awkward | M | L | Deterministic stop-word filtering with client name and original word order |
| Calendly webhook exceeds acceptable runtime while waiting | L | M | Short bounded retry window only |
| Missing env vars hide integration failure | M | M | Log structured warnings and alert the firm only for hard failures |

## Verification
- Unit-test title generation and create-matter payload shape, especially absence of transcript fields.
- Unit-test paid fan-out delivery, duplicate suppression, and hard failure alert.
- Unit-test Calendly note delivery for immediate mapping, delayed mapping, missing mapping alert, and Zap failure alert.
- Run `npm run test` and `npm run lint`.
- Rollback plan: remove the two new Smokeball helper imports/wiring and unset `ZAPIER_APPOINTMENT_NOTE_WEBHOOK_URL`; existing payment, upload, and Calendly email paths continue to work.
