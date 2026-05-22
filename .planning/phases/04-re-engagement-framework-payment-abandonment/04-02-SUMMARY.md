---
phase: 04-re-engagement-framework-payment-abandonment
plan: 02
subsystem: email-reminders
tags: [email-reminders, qstash, redis, hmac, react-email, dcem, activity-log]
requires:
  - "@upstash/qstash"
  - "@upstash/redis"
  - "@react-email/components"
  - "node:crypto"
  - "src/lib/email-reminders/format-matter (Plan 04-01, parallel worktree)"
provides:
  - scheduleEmailReminder
  - cancelEmailReminder
  - EmailReminderType
  - EmailReminderPayload
  - cancelLookupKey
  - deliveryNxKey
  - writeCancelLookup
  - readCancelLookup
  - deleteCancelLookup
  - tryClaimDelivery
  - isPaymentCompleted
  - isUnsubscribed
  - signUnsubscribeToken
  - verifyUnsubscribeToken
  - logActivity
  - aestDate
  - ActivityEvent
  - PENDING_SIGNOFF
  - PAYMENT_1H_SUBJECT
  - PAYMENT_24H_SUBJECT
  - PAYMENT_1H_BODY
  - PAYMENT_24H_BODY
  - LSS_EXPLAINER_BLOCK
  - UNSUBSCRIBE_LINK_LABEL
  - assertCopyApproved
  - ReengagementPaymentEmail
  - ReengagementPaymentEmailProps
affects:
  - "Plan 04-03 (Wave 2) consumes all of the above to wire the route handler, unsubscribe API, and call sites"
tech-stack:
  added: []
  patterns:
    - "v1.0 SMS reminder pattern mirrored 1:1 (lazy QStash Client, warn-and-return env guards, try/catch on cancel that never rethrows)"
    - "Two-key Redis idempotency: cancel-lookup + delivery NX (delivery NX written by Plan 04-03 route handler)"
    - "HMAC-SHA256/base64url one-click unsubscribe with constant-time compare (timingSafeEqual on equal-length Buffers)"
    - "Isolated activity-log: full-body try/catch swallows redis failures, never throws"
    - "DCEM-locked copy with PENDING_SIGNOFF placeholders + production guard (assertCopyApproved)"
    - "Single React Email template with variant prop (1h hybrid + 24h follow-up)"
key-files:
  created:
    - src/lib/email-reminders/state.ts
    - src/lib/email-reminders/dispatch.ts
    - src/lib/email-reminders/unsubscribe.ts
    - src/lib/email-reminders/copy.ts
    - src/lib/digest/activity-log.ts
    - src/lib/email/templates/reengagement-payment.tsx
  modified: []
decisions:
  - "Used `showFooter={false}` on EmailLayout in reengagement-payment.tsx to avoid double-Footer rendering — EmailLayout renders Footer by default, and the plan body explicitly places `<Footer />` inside the EmailLayout children"
  - "Kept `process.env` reads inside function bodies (not module-level) so per-test `delete process.env.X` works against scheduleEmailReminder/cancelEmailReminder/sign/verify"
metrics:
  tasks: 3
  files_created: 6
  files_modified: 0
  duration: ~10min
  completed: 2026-05-07
---

# Phase 04 Plan 02: Framework + Payment-Abandonment Summary

Implements the six framework modules (state, dispatch, unsubscribe, copy, activity-log, reengagement-payment template) per Plan 04-02 contracts so Wave 2 Plan 04-03 can wire them into the HTTP layer and call sites without further internal-API decisions.

## Tasks Executed

| Task | Name                                                      | Commit  | Files                                                                                                  |
| ---- | --------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| 1    | state.ts + dispatch.ts (mirror of v1.0 SMS pattern)       | 9ff8456 | src/lib/email-reminders/state.ts, src/lib/email-reminders/dispatch.ts                                  |
| 2    | unsubscribe.ts (HMAC) + digest/activity-log.ts (isolated) | 18ccfd7 | src/lib/email-reminders/unsubscribe.ts, src/lib/digest/activity-log.ts                                 |
| 3    | copy.ts (DCEM + PENDING_SIGNOFF) + reengagement template  | 219d453 | src/lib/email-reminders/copy.ts, src/lib/email/templates/reengagement-payment.tsx                      |

## Locked Contracts Encoded

### Redis key namespaces

| Prefix                                        | TTL                       | Written by                           | Read by                                    |
| --------------------------------------------- | ------------------------- | ------------------------------------ | ------------------------------------------ |
| `email-reminder:{type}:{sessionId}`           | `delaySeconds + 7200`     | `writeCancelLookup` (this plan)      | `readCancelLookup`, `deleteCancelLookup`   |
| `email-reminder-sent:{type}:{sessionId}`      | caller-supplied (Plan 03) | `tryClaimDelivery` helper exported   | Plan 04-03 route handler                   |
| `payment-completed:{sessionId}`               | (written by handlePaid)   | (Plan 04-03 wires `handlePaid`)      | `isPaymentCompleted` (delivery-time gate)  |
| `unsubscribe:{sessionId}`                     | 30d (written by Plan 03)  | (Plan 04-03 unsubscribe API route)   | `isUnsubscribed` (delivery-time gate)      |
| `activity:{YYYY-MM-DD-AEST}` (LPUSH list)     | 14d                       | `logActivity` helper                 | Phase 6 aggregator                         |

All key string templates appear verbatim in source so test greps pass.

### Env vars (absent-safe, OPS-V1.1-01)

| Var                                  | Used by                                      | Absent behaviour                                                |
| ------------------------------------ | -------------------------------------------- | --------------------------------------------------------------- |
| `QSTASH_TOKEN`                       | scheduleEmailReminder, cancelEmailReminder   | warn `email_reminder_skipped reason=no_qstash_token` and return |
| `APP_URL`                            | scheduleEmailReminder                        | warn `email_reminder_skipped reason=no_app_url` and return      |
| `EMAIL_REMINDER_UNSUBSCRIBE_SECRET`  | signUnsubscribeToken, verifyUnsubscribeToken | sign returns `null` + warn; verify returns `false` + warn       |

All env reads happen INSIDE function bodies (not module-level) so per-test `delete process.env.X` toggling works.

### Structured-log event names emitted (grep-verified)

- `email_reminder_skipped` (with `reason: "no_qstash_token"` or `"no_app_url"`)
- `email_reminder_scheduled`
- `email_reminder_cancelled`
- `email_reminder_cancel_failed`
- `unsubscribe_secret_missing`
- `activity_log_failed`

(Plan 04-03 will add `email_reminder_sent`, `email_reminder_failed` in the route handler.)

## What Plan 04-03 Consumes

From `@/lib/email-reminders/dispatch`:
- `scheduleEmailReminder(type, sessionId, delaySeconds)` — call from `selectUrgency` after inquiry email succeeds
- `cancelEmailReminder(type, sessionId)` — call from `handlePaid` and unsubscribe route
- Type alias `EmailReminderType`, payload interface `EmailReminderPayload`

From `@/lib/email-reminders/state`:
- `tryClaimDelivery(type, sessionId, ttlSeconds)` — NX claim in route handler before send
- `isPaymentCompleted(sessionId)` — delivery-time payment gate
- `isUnsubscribed(sessionId)` — delivery-time unsubscribe gate

From `@/lib/email-reminders/unsubscribe`:
- `signUnsubscribeToken(sessionId)` — to render unsubscribeUrl in template
- `verifyUnsubscribeToken(sessionId, token)` — in unsubscribe API route GET handler

From `@/lib/email-reminders/copy`:
- `assertCopyApproved()` — call from route handler BEFORE Resend dispatch (production guard)
- `PAYMENT_1H_SUBJECT`, `PAYMENT_24H_SUBJECT` — Resend `subject` field
- (`PAYMENT_1H_BODY`, `PAYMENT_24H_BODY`, `LSS_EXPLAINER_BLOCK` are read inside the template — route handler does not need them directly)

From `@/lib/digest/activity-log`:
- `logActivity(event, sessionId, payload?)` — fire-and-forget call after each Phase 4 event (lead_created, payment_completed, payment_abandoned_*, unsubscribed)

From `@/lib/email/templates/reengagement-payment`:
- `default ReengagementPaymentEmail` — pass to `@react-email/render` then to Resend in route handler

## Pending Firm-Principal Sign-Off (PENDING_SIGNOFF placeholders)

The following copy fields export the `PENDING_SIGNOFF` sentinel and require firm-principal sign-off before production deploy. The runtime guard `assertCopyApproved()` (called from Plan 04-03's route handler) throws in production if any of these are still placeholders.

- `PAYMENT_1H_SUBJECT` — subject line for the 1h hybrid email
- `PAYMENT_24H_SUBJECT` — subject line for the 24h follow-up email
- `PAYMENT_1H_BODY({ clientName, matterSnippet, resumeUrl, unsubscribeUrl })` — body of the 1h hybrid email (gentle nudge paragraph)
- `PAYMENT_24H_BODY({ clientName, matterSnippet, resumeUrl, unsubscribeUrl })` — body of the 24h follow-up email
- `LSS_EXPLAINER_BLOCK` — eight fields covering the side-by-side urgent vs non-urgent tier table (urgent/nonUrgent × title/price/description/nextStep)

Tracked in STATE.md todo: "Confirm with firm principal: copy for the 1h hybrid LSS-explainer email block" (already present).

## Cross-Worktree Dependency

`src/lib/email/templates/reengagement-payment.tsx` imports `snippetMatter` from `@/lib/email-reminders/format-matter`. That module is owned by Plan 04-01 in a sibling parallel worktree and does **NOT** exist in this worktree. As a result:

- `npx tsc --noEmit` in **this** worktree fails with one error (`Cannot find module '@/lib/email-reminders/format-matter'`).
- `npx vitest run src/lib/email-reminders/__tests__/dispatch.test.ts` cannot run in this worktree because the test file is also owned by Plan 04-01.

This is the expected parallel-execution state per the orchestrator's note: "test verification will occur after both worktrees merge back in the orchestrator's post-merge gate." The post-merge gate runs:

```
npx tsc --noEmit                                                       # expected exit 0
npx vitest run src/lib/email-reminders/__tests__/format-matter.test.ts # expected exit 0
npx vitest run src/lib/email-reminders/__tests__/dispatch.test.ts      # expected 6/9 GREEN; 3 RED (route-handler tests — Plan 04-03 closes)
npx vitest run src/lib/sms/__tests__/                                  # expected exit 0 (no regression)
```

## Deviations from Plan

### 1. EmailLayout `showFooter={false}` (Rule 1 - Bug)

**Found during:** Task 3
**Issue:** The plan's template body shows `<Footer />` rendered inside `<EmailLayout>` children, but `EmailLayout` renders `Footer` by default (`showFooter = true`). Following the plan body literally would render the footer twice.
**Fix:** Pass `showFooter={false}` to `<EmailLayout>` so the explicit `<Footer />` placement at the end of the template body remains canonical.
**Files modified:** `src/lib/email/templates/reengagement-payment.tsx`
**Commit:** 219d453

### 2. Type annotation on `PAYMENT_*_SUBJECT` exports (Rule 3 - Blocking)

**Found during:** Task 3
**Issue:** TypeScript inferred `PAYMENT_1H_SUBJECT` and `PAYMENT_24H_SUBJECT` as the literal `"PENDING_SIGNOFF"` (because they were assigned the `as const` `PENDING_SIGNOFF` sentinel), which prevented future sign-off rotation without a wider type narrowing.
**Fix:** Annotated both as `: string = PENDING_SIGNOFF` so post-sign-off the firm principal can replace the value with any string without changing call sites.
**Files modified:** `src/lib/email-reminders/copy.ts`
**Commit:** 219d453

No other deviations. The 6 files match the planned shapes verbatim.

## Threat Surface Scan

No new security-relevant surface beyond what the plan's threat model already covers (HMAC-signed unsubscribe — INFRA-07 — implemented per spec). No threat flags.

## Self-Check: PASSED

- File `src/lib/email-reminders/state.ts` exists: FOUND
- File `src/lib/email-reminders/dispatch.ts` exists: FOUND
- File `src/lib/email-reminders/unsubscribe.ts` exists: FOUND
- File `src/lib/email-reminders/copy.ts` exists: FOUND
- File `src/lib/digest/activity-log.ts` exists: FOUND
- File `src/lib/email/templates/reengagement-payment.tsx` exists: FOUND
- Commit 9ff8456 in git log: FOUND
- Commit 18ccfd7 in git log: FOUND
- Commit 219d453 in git log: FOUND

Cross-worktree compile passes deferred to post-merge gate (expected — see "Cross-Worktree Dependency" section).
