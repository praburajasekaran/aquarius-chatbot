---
phase: 02-qstash-scheduler
plan: "02"
subsystem: sms-reminder
tags: [qstash, redis, sms, webhook, scheduler, dedup, vitest]
dependency_graph:
  requires:
    - "02-01 — @upstash/qstash installed, RED tests written"
    - "src/lib/sms/dispatch.ts (sendSms)"
    - "src/lib/sms/copy.ts (REMINDER_SMS_COPY)"
    - "src/lib/kv.ts (redis singleton)"
  provides:
    - "scheduleReminderSms(sessionId, phone, uploadLink) — Phase 3 consumes at payment time"
    - "cancelPendingReminder(sessionId) — Phase 3 consumes at upload time"
    - "POST /api/webhooks/sms-reminder — QStash-signed delivery endpoint"
    - "uploaded:{sessionId} Redis flag contract — Phase 3 upload routes will write this key"
  affects:
    - "Phase 3 handleIntakePaid() orchestrator (consumes scheduleReminderSms)"
    - "Phase 3 late-upload route (consumes cancelPendingReminder)"
tech_stack:
  added:
    - "@upstash/qstash Client (publishJSON, messages.cancel)"
    - "@upstash/qstash/nextjs verifySignatureAppRouter"
  patterns:
    - "Lazy QStash Client construction (no module-level instantiation)"
    - "Absent-env guard: QSTASH_TOKEN/APP_URL absent → warn + return, never throw"
    - "Two-key Redis dedup: sms-reminder:{id} (cancel-lookup) + sms-reminder-sent:{id} (delivery NX)"
    - "Upload-flag short-circuit: redis.get('uploaded:{id}') before NX write"
key_files:
  created:
    - ".claude/worktrees/clicksend-sms/src/lib/sms/reminder.ts"
    - ".claude/worktrees/clicksend-sms/src/app/api/webhooks/sms-reminder/route.ts"
  modified:
    - ".claude/worktrees/clicksend-sms/src/lib/sms/__tests__/reminder.test.ts"
decisions:
  - "Two-key dedup design confirmed: sms-reminder:{id} for cancel-lookup only; sms-reminder-sent:{id} NX for delivery dedup — prevents cancel-deletes-dedup-key race"
  - "Upload guard reads uploaded:{sessionId} Redis key (not getSession()) — session TTL=1h is too short for 24h reminder window"
  - "verifySignatureAppRouter wraps handleReminderDelivery as POST export — structural SCHED-02 compliance, untestable without real signing keys"
  - "REMINDER_DELAY_SECONDS = 86400 (number literal), not string '24h' — QStash SDK requires numeric seconds"
  - "REMINDER_KEY_TTL_SECONDS = 26 * 3600 = 93600 — 2h buffer beyond 24h delivery to handle QStash retry window"
metrics:
  duration_minutes: 2
  completed_date: "2026-04-27"
  tasks_completed: 2
  files_created: 2
  files_modified: 1
---

# Phase 02 Plan 02: QStash Reminder Implementation Summary

QStash 24h SMS reminder with cancellation, upload-flag short-circuit, NX dedup, and absent-env safety — 5/5 tests GREEN.

## Final Test State

| Suite | Tests | Status |
|-------|-------|--------|
| `reminder.test.ts` (Phase 2) | 5/5 | GREEN |
| `dispatch.test.ts` (Phase 1) | 6/6 | GREEN |
| Full suite | 11/11 | GREEN |

## Files Produced

### `.claude/worktrees/clicksend-sms/src/lib/sms/reminder.ts`

Exports `scheduleReminderSms` and `cancelPendingReminder`.

**Redis key prefixes used in production code:**
- `sms-reminder:{sessionId}` — written by `scheduleReminderSms` (TTL 93600s), read+deleted by `cancelPendingReminder`

**Env var read points and absent-safe behavior:**
- `QSTASH_TOKEN` absent → `console.warn({ event: "reminder_skipped", reason: "no_qstash_token" })`, returns without throwing, no `redis.set` called (verified by SCHED-01 absent-token test)
- `APP_URL` absent (with token present) → `console.warn({ event: "reminder_skipped", reason: "no_app_url" })`, returns without throwing
- Both env vars read inside function bodies — per-test `delete process.env.X` toggling works correctly

**QStash call shape** (verified by SCHED-01 happy path test):
```
publishJSON({ url: APP_URL + '/api/webhooks/sms-reminder', body: { sessionId, phone, uploadLink }, delay: 86400 })
```

### `.claude/worktrees/clicksend-sms/src/app/api/webhooks/sms-reminder/route.ts`

Exports `handleReminderDelivery` (named inner function) and `POST = verifySignatureAppRouter(handleReminderDelivery)`.

**Redis key prefixes used in production code:**
- `uploaded:{sessionId}` — read-only upload guard; Phase 3 upload routes will write this key
- `sms-reminder-sent:{sessionId}` — NX dedup write (TTL 93600s); separate from cancel-lookup key

**Order of operations in handleReminderDelivery:**
1. `redis.get('uploaded:{id}')` → truthy → `new Response("skipped")` (sendSms not called)
2. `redis.set('sms-reminder-sent:{id}', '1', { nx: true, ex: 93600 })` → null → `new Response("deduped")` (sendSms not called)
3. `sendSms(phone, REMINDER_SMS_COPY(uploadLink))` → `new Response("ok")`

## Phase 3 Consumption Contract

Phase 3 consumes the following from this plan:

| Export | Call site | When called |
|--------|-----------|-------------|
| `scheduleReminderSms(sessionId, phone, uploadLink)` | `handleIntakePaid()` orchestrator | After successful payment |
| `cancelPendingReminder(sessionId)` | Late-upload route | When client uploads documents |
| `uploaded:{sessionId}` Redis flag | Phase 3 late-upload route writes it | Before calling `cancelPendingReminder` |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed arrow function mock in reminder.test.ts for vitest v4 constructor compatibility**
- **Found during:** Task 1 first GREEN run attempt
- **Issue:** `vi.mock("@upstash/qstash", () => ({ Client: vi.fn().mockImplementation(() => ({...})) }))` — vitest v4.1.5 requires the implementation function to be constructable (`function() {}` not `() => {}`). Arrow functions cannot be used as constructors; `new Client()` threw `"() => ({...}) is not a constructor"`.
- **Fix:** Changed implementation from arrow function `() => ({ publishJSON: ..., messages: ... })` to regular function `function() { return { publishJSON: ..., messages: ... }; }`
- **Files modified:** `.claude/worktrees/clicksend-sms/src/lib/sms/__tests__/reminder.test.ts`
- **Commit:** d5f8133

No other deviations — both files implemented exactly as planned.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| `src/lib/sms/reminder.ts` | FOUND |
| `src/app/api/webhooks/sms-reminder/route.ts` | FOUND |
| `02-02-SUMMARY.md` | FOUND |
| Commit d5f8133 (reminder.ts + test fix) | FOUND |
| Commit e798f45 (route.ts) | FOUND |
