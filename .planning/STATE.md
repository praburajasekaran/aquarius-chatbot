---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: milestone
status: validating
last_updated: "2026-05-21T22:10:00+05:30"
last_activity: 2026-05-21 -- BPoint ngrok-local browser UAT reached payment success and upload step; evidence bundle updated as partial
progress:
  total_phases: 3
  completed_phases: 0
  total_plans: 3
  completed_plans: 0
  percent: 0
---

# Project State: Aquarius Lawyers Chatbot — Lifecycle Email Flow + Re-engagement

---

## Project Reference

**Core Value:** Every visitor who shows intent gets a humane chance to convert; every paying client reaches a complete handoff to the firm; the firm sees one coherent morning summary instead of inbox noise.
**Project file:** `.planning/PROJECT.md`
**Requirements:** `.planning/REQUIREMENTS.md` (19 v1.1 requirements)
**Roadmap:** `.planning/ROADMAP.md` (3 phases — Phase 4, 5, 6 continuing from v1.0)
**Architecture:** `.planning/codebase/ARCHITECTURE.md`
**Pitfalls:** `.planning/research/PITFALLS.md` (from v1.0; still relevant for QStash + Redis patterns)
**v1.0 archive:** `.planning/milestones/v1.0/`

---

## Current Position

Phase: 04-validation — PARTIAL UAT
Plan: ngrok-local BPoint browser validation
Status: Browser payment path partially verified; full cutover evidence still pending
Last activity: 2026-05-21 -- Local Next app exposed via ngrok; BPoint iframe payment completed; chat advanced to Upload Supporting Documents
Resume from: `.planning/phases/04-validation/04-UAT-EVIDENCE.md`

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases total | 3 |
| Phases complete | 0 |
| Requirements total | 19 |
| Requirements complete | 0 |
| Session started | 2026-05-07 |

---

## Accumulated Context

### Key Decisions Made (v1.1)

| Decision | Rationale |
|----------|-----------|
| Defer v1.0 Phase 3 and ship v1.1 against existing `handlePaid` / `selectUrgency` seams | User directive; v1.1 re-engagement value > the abstract benefit of an in-flight refactor; rename is mechanical when Phase 3 ships later |
| Email for slow-decision actions (payment, booking), SMS for fast actions (upload) — no doubling up | Avoids pestering visitor with 3 nudges in 24h on overlapping channels |
| Daily 9am AEST firm digest replaces per-event firm alerts for abandonment | Small firm + 5 emails per session = noise → tuned out → system fails |
| Smokeball stays paid-leads-only; abandonment is digest-only | Avoids polluting the firm's matter list with non-paying inquiries |
| Two-key idempotency on every reminder (cancel-lookup + delivery NX) | v1.0 SCHED-05 lesson — single-key loses the messageId on cancel races |
| One-click courtesy unsubscribe (HMAC-signed) on every reminder | Defensive against Spam Act grey zone for re-engagement; reputationally protective |
| No business-hour deferral | Calendly enforces slot validity; visitor reads when they read |
| Hybrid 1h email (gentle nudge + LSS explainer) instead of two separate emails | One touchpoint, higher info density, less risk of reading like a sales pitch |
| Continue v1.0's coarse 3-phase mergeable-boundary phasing | Pattern that worked for v1.0 |

### Carried Over From v1.0

- **QStash scheduler**: `@upstash/qstash` is already installed; signature verification (`verifySignatureAppRouter`) is wired; reminder webhook pattern is proven
- **Two-key Redis idempotency pattern**: `*-completed:{sessionId}` for cancel-lookup, `*-reminder-sent:{sessionId}` NX for delivery dedup — copy from `src/lib/sms/reminder.ts` and `src/app/api/webhooks/sms-reminder/route.ts`
- **Absent-safe env var pattern**: app must boot and function when `QSTASH_*` are missing — schedule logs warning and returns
- **Locked-copy DCEM mindset**: factual, transactional, no promotional language. Lock copy as named constants where possible
- **Phone redaction pattern**: not directly used in v1.1, but the same masked-logging discipline applies to email addresses in logs

### Critical Constraints to Remember

- **v1.0 Phase 3 may land first**: v1.1 callers hook into `handlePaid` and the `selectUrgency` tool. If a parallel worktree completes Phase 3 (renaming to `handleIntakePaid`), v1.1 imports rename mechanically. No semantic change.
- **Existing five happy-path emails are NOT to be redesigned in v1.1**: only audited for diagram alignment. Behavioural change is out of scope.
- **All v1.1 reminder code must degrade silently when env vars absent** — local dev, PR previews must continue to work.
- **Unsubscribe must be HMAC-signed** so a leaked URL can't disable a third party's reminders.

### Pitfalls to Watch (carried from v1.0 + new for v1.1)

- Pitfall 1 (carried): Cancel races with delivery — two-key Redis pattern mitigates
- Pitfall 2 (carried): QStash duplicate delivery — NX delivery key mitigates
- Pitfall 3 (carried): App breaks when env vars missing — absent-safe pattern mitigates
- Pitfall 4 (new): Unsubscribe link replay across sessions — HMAC-signing scoped to sessionId mitigates
- Pitfall 5 (new): Digest sends empty email on quiet days — skip-if-empty check
- Pitfall 6 (new): Visitor pays at 14:59:59 just before 1h timer fires — defence-in-depth: cancel hook clears Redis key AND delivery handler re-reads `payment-completed:{sessionId}` and short-circuits
- Pitfall 7 (new): Firm digest aggregator misses a window if cron is late — read previous 24h by timestamp, not by "since last digest"
- BPoint UAT (2026-05-21): duplicate/concurrent checkout setup can create multiple AuthKeys for the same session unless guarded by an atomic `bpoint-authkey:{sessionId}` Redis NX claim. Symptom: `/api/checkout/process` returns `authkey_mismatch`.
- BPoint UAT (2026-05-21): successful `processiframetxn` can redirect with a `ResultKey` that `retrieveTransaction(ResultKey)` reports as `APIResponse.ResponseCode=118 "Invalid transaction number"`. Confirm route now uses a server-recorded `bpoint-result:{ResultKey}` fallback from the successful process response.
- Chat flow (2026-05-21): `initiatePayment` can be called before `selectUrgency` has created the intake. PaymentCard now displays a not-ready message and prompt/tool descriptions explicitly forbid pre-intake payment.

### Files Likely To Touch (v1.1)

**New files (Phases 4–6):**

- `src/lib/email-reminders/dispatch.ts` — generalised reminder framework
- `src/lib/email-reminders/copy.ts` — locked-copy strings for all v1.1 templates
- `src/lib/email-reminders/state.ts` — Redis state-key helpers (cancel + dedup)
- `src/lib/email-reminders/unsubscribe.ts` — HMAC sign/verify
- `src/app/api/webhooks/email-reminder/route.ts` — QStash delivery target
- `src/app/api/email/unsubscribe/route.ts` — one-click unsubscribe endpoint
- `src/lib/email/templates/reengagement-payment-1h.tsx`
- `src/lib/email/templates/reengagement-payment-24h.tsx`
- `src/lib/email/templates/reengagement-appointment-4h.tsx` *(combined template variant possible)*
- `src/lib/email/templates/reengagement-appointment-24h.tsx`
- `src/lib/email/templates/firm-daily-digest.tsx`
- `src/lib/digest/aggregate.ts` — reads activity log
- `src/app/api/cron/daily-digest/route.ts` — QStash 9am AEST cron target

**Modified existing files (Phases 4–6):**

- `src/lib/tools/select-urgency.ts` — add `scheduleEmailReminder` calls at intake completion
- `src/lib/intake/handle-paid.ts` — add `cancelEmailReminder('payment', ...)` + `scheduleEmailReminder('appointment', ...)` *(if non-urgent + uploaded)*
- `src/app/api/webhooks/calendly/route.ts` — add `cancelEmailReminder('appointment', ...)` on booking
- `src/app/api/late-upload/session/route.ts` (or `src/lib/late-upload/handle-completed.ts`) — schedule appointment reminder on upload-success if non-urgent
- `src/lib/intake.ts` — add activity-log writer (Redis list per day) for digest aggregation

### Todos

- [ ] Confirm with firm principal: copy for the 1h hybrid LSS-explainer email block (factual description of urgent vs non-urgent paths and what's included in each)
- [ ] Confirm with firm principal: digest delivery email (currently `FIRM_NOTIFY_EMAIL`) and digest preview-text format
- [ ] Add `EMAIL_REMINDER_UNSUBSCRIBE_SECRET` (HMAC key) to Vercel production environment
- [ ] Decide whether `src/lib/email-reminders/` and `src/lib/sms/` share a common scheduler primitive or remain duplicated (likely answered during plan-phase 4)
- [ ] Operational: monitor first week of digest sends for false-positive abandonments (visitor opens email but doesn't click — not necessarily lost)
- [ ] Switch Vercel Blob to private + signed URLs (audit H4) — see [.planning/todos/pending/2026-05-03-switch-vercel-blob-to-private-signed-urls.md](.planning/todos/pending/2026-05-03-switch-vercel-blob-to-private-signed-urls.md)
- [ ] Complete BPoint TEST-01 evidence: receipt email screenshot, upload-token URL, durable logs, and either Vercel-preview UAT smoke output or ngrok-compatible UAT harness output.
- [ ] Validate TEST-02 Smokeball invoice line-item reconciliation with firm-provided screenshot.
- [ ] Validate TEST-03 failure paths: declined card, expired AuthKey, replayed redirect, webhook retry.
- [ ] Fix or replace local Resend test credentials before relying on local email evidence (`validation_error — API key is invalid` observed 2026-05-21).

### Blockers

- Full BPoint cutover evidence remains incomplete: 2026-05-21 ngrok-local pass verified payment success → upload step only.
- Local Resend key invalid during 2026-05-21 UAT, blocking receipt-email evidence.

---

## Session Continuity

To resume work, read:

1. This file (`STATE.md`) — current position and decisions
2. `ROADMAP.md` — phase goals and success criteria
3. The current phase's plan file (`.planning/phases/0[N]-*/0[N]-0[M]-PLAN.md`) when created

Next action: continue `.planning/phases/04-validation/04-RUNBOOK.md` from TEST-01 evidence capture, preferably on Vercel preview or after adjusting `tests/uat/setup.ts` for ngrok-local URLs.

---

*State initialised: 2026-04-24 (v1.0)*
*Last updated: 2026-05-21 — BPoint ngrok-local browser UAT partially green; payment reaches upload step after AuthKey race, ResultKey fallback, and pre-intake payment guard fixes.*
