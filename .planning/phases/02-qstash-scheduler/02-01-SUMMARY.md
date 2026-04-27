---
phase: 02-qstash-scheduler
plan: "01"
subsystem: sms-reminder
tags: [qstash, testing, tdd, red-state, vitest]
dependency_graph:
  requires: [01-dispatch-foundation]
  provides: [reminder-test-stubs, qstash-dependency]
  affects: [02-02-PLAN]
tech_stack:
  added: ["@upstash/qstash@2.10.1"]
  patterns: [absent-safe-env-guard, two-key-dedup-design, inner-function-testability-export]
key_files:
  created:
    - .claude/worktrees/clicksend-sms/src/lib/sms/__tests__/reminder.test.ts
  modified:
    - .claude/worktrees/clicksend-sms/package.json
    - .claude/worktrees/clicksend-sms/package-lock.json
decisions:
  - "@upstash/qstash@2.10.1 installed as production dep (not devDep) — used at runtime by reminder.ts and route.ts"
  - "Two-key dedup design: sms-reminder:{sessionId} for cancel-lookup messageId; sms-reminder-sent:{sessionId} NX for handler delivery dedup — avoids key conflict on QStash retry"
  - "verifySignatureAppRouter mocked as passthrough in tests — structural HOC cannot be unit-tested without real signing keys (per 02-VALIDATION.md)"
metrics:
  duration: "~10 minutes"
  completed: "2026-04-27T17:50:42Z"
  tasks_completed: 2
  files_modified: 3
---

# Phase 02 Plan 01: QStash Dependency + RED Test Stubs Summary

**One-liner:** Install `@upstash/qstash@2.10.1` and write 5 exhaustive failing test stubs (RED state) covering SCHED-01/03/04/05 before any implementation lands.

---

## What Was Built

### Task 1: Install @upstash/qstash (production dependency)

- Installed `@upstash/qstash@2.10.1` from npm registry into the `feat/clicksend-urgent-sms` worktree
- Placed in `dependencies` (not `devDependencies`) — required at runtime by `reminder.ts` and `route.ts`
- Verified both bare import (`@upstash/qstash`) and nextjs subpath (`@upstash/qstash/nextjs`) resolve
- `package-lock.json` updated with 4 new packages (qstash + transitive deps)

**Installed version:** `2.10.1` (exactly as planned — published 2026-03-18)

### Task 2: 5 Failing Test Stubs (RED State)

Created `src/lib/sms/__tests__/reminder.test.ts` with 5 `describe` blocks, one per requirement:

| Describe | Requirement | Assert |
|----------|------------|--------|
| `scheduleReminderSms — absent QSTASH_TOKEN (SCHED-01)` | SCHED-01a | `console.warn` called with `reminder_skipped`/`no_qstash_token`; `redis.set` never called |
| `scheduleReminderSms — happy path stores messageId 26h (SCHED-01)` | SCHED-01b | `publishJSON` called with `delay: 86400`; `redis.set("sms-reminder:sess-A", "msg-123", { ex: 93600 })` |
| `cancelPendingReminder — reads messageId, calls cancel (SCHED-04)` | SCHED-04 | `redis.get("sms-reminder:sess-B")`; `messages.cancel("msg-456")`; `redis.del("sms-reminder:sess-B")` |
| `handleReminderDelivery — uploaded flag short-circuit (SCHED-03)` | SCHED-03 | Response text `"skipped"`; `sendSms` never called; `redis.get("uploaded:sess-C")` called |
| `handleReminderDelivery — NX dedup on second delivery (SCHED-05)` | SCHED-05 | Response text `"deduped"`; `redis.set("sms-reminder-sent:sess-D", "1", { nx: true, ex: 93600 })`; `sendSms` never called |

---

## Redis Key Prefixes Confirmed in Tests

| Key | Value | TTL | Purpose |
|-----|-------|-----|---------|
| `sms-reminder:{sessionId}` | QStash messageId string | 26h (93600s) | Cancel-lookup; written by scheduler, read+deleted by cancel |
| `sms-reminder-sent:{sessionId}` | `"1"` | 26h (93600s) NX | Handler delivery dedup — separate from cancel-lookup key |
| `uploaded:{sessionId}` | `"1"` | 26h | Upload state flag; Phase 3 writes; Phase 2 handler reads |

---

## RED State Output

```
 FAIL  src/lib/sms/__tests__/reminder.test.ts
Error: Cannot find module '/src/lib/sms/reminder' imported from ...reminder.test.ts
 ❯ src/lib/sms/__tests__/reminder.test.ts:38:1

 Test Files  1 failed (1)
      Tests  no tests
   Start at  23:20:03
   Duration  105ms
```

Failing specifically on missing import of `../reminder` — NOT due to syntax errors in the test file.  
`@/app/api/webhooks/sms-reminder/route` would also fail if resolver got that far.

---

## Phase 1 Non-Regression

`dispatch.test.ts`: 6/6 tests GREEN — Phase 1 unaffected by this plan.

---

## Deviations from Plan

None — plan executed exactly as written.

The plan's verify command for the `./package.json` subpath export (`require('@upstash/qstash/package.json')`) failed because the package uses strict export maps (this subpath is not exported). The actual acceptance criteria — `require('@upstash/qstash')` and `require('@upstash/qstash/nextjs')` — both succeed. This is not a deviation from the plan's acceptance criteria; the `node -e "console.log(Object.keys(require('@upstash/qstash/package.json').exports...)"` line in the task action section was informational/exploratory and all named acceptance criteria passed.

---

## Commits

| Hash | Message | Task |
|------|---------|------|
| `d7249f6` | `chore(02-01): install @upstash/qstash@^2.10.1 as production dependency` | Task 1 |
| `b39e5ae` | `test(02-01): add 5 failing test stubs for Phase 2 success criteria (RED)` | Task 2 |

---

## Self-Check: PASSED

- FOUND: `.claude/worktrees/clicksend-sms/src/lib/sms/__tests__/reminder.test.ts`
- FOUND: `.planning/phases/02-qstash-scheduler/02-01-SUMMARY.md`
- FOUND: commit `d7249f6` (chore: install @upstash/qstash)
- FOUND: commit `b39e5ae` (test: 5 failing stubs RED)
