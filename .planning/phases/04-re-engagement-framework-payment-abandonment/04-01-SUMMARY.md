---
phase: 04
plan: 01
subsystem: email-reminders
tags: [tdd, red-baseline, format-matter, contract-tests, qstash, redis, hmac]
requires:
  - "@upstash/qstash (already installed via v1.0 Phase 2)"
  - "@upstash/redis (already installed)"
  - "vitest (already installed)"
  - "v1.0 SMS reminder pattern (src/lib/sms/reminder.ts, src/app/api/webhooks/sms-reminder/route.ts) as canonical analog"
provides:
  - "src/lib/email-reminders/format-matter.ts — `snippetMatter(s)` pure helper (Decision 4): first sentence or 117-char + ellipsis"
  - "src/lib/email-reminders/__tests__/format-matter.test.ts — 13 GREEN unit tests covering empty/whitespace/multi-sentence/multiline/length-edge cases"
  - "src/lib/email-reminders/__tests__/dispatch.test.ts — 9 RED contract tests (TEST-V1.1-01) locking the framework contract for 04-02 + 04-03"
affects:
  - "Plan 04-02 (framework implementation): every signature, Redis key prefix, TTL, gate ordering, and console event name in dispatch.test.ts is a hard assertion that 04-02 must satisfy without test edits"
  - "Plan 04-03 (delivery route): handleEmailReminderDelivery must be importable from @/app/api/webhooks/email-reminder/route, must run payment-completed and unsubscribe gates BEFORE the NX dedup write, must NX-set with ex=604800"
  - "Plan 04-02 reengagement-payment template: can import snippetMatter directly (24h variant per Decision 4; 1h variant optional)"
tech-stack:
  added: []
  patterns:
    - "TDD RED → GREEN: format-matter shipped GREEN this plan; dispatch tests sit RED until 04-02/04-03 land"
    - "Mock external boundaries only — never mock the modules under test (per v1.0 sms reminder.test.ts canonical pattern)"
    - "Inner-handler-extracted-from-verifySignatureAppRouter pattern (mocked HOC = passthrough so unit tests reach handleEmailReminderDelivery directly)"
    - "Contract-locking via baked-in literals: 10800, 604800 (TTLs), exact key prefixes, exact event names — drift in 04-02/04-03 fails the suite"
key-files:
  created:
    - "src/lib/email-reminders/format-matter.ts (35 lines, pure function, zero imports, zero side effects)"
    - "src/lib/email-reminders/__tests__/format-matter.test.ts (74 lines, 13 it() cases, GREEN)"
    - "src/lib/email-reminders/__tests__/dispatch.test.ts (367 lines, 9 describe blocks, RED via Cannot-find-module)"
  modified: []
decisions:
  - "Mocked @/lib/digest/activity-log via vi.importActual passthrough (rather than vi.fn() stub) so test 9 part 2 can exercise the REAL isolation catch branch when Plan 04-02 lands the module — vi.fn() stub would record the call but never trigger the actual catch + warn flow that Decision 3 requires"
  - "Added 13 format-matter cases (plan minimum was 11): added 121-char no-punctuation truncation case + \\r\\n line-ending normalisation case to exhaustively cover Decision 4's edge cases — both expand acceptance not deviation"
metrics:
  duration: ~6 minutes
  tasks_completed: 2
  files_created: 3
  files_modified: 0
  commits: 2
  completed: "2026-05-07T12:51:34Z"
---

# Phase 4 Plan 1: RED Tests + format-matter Helper Summary

Test-first RED baseline for the v1.1 payment-abandonment framework: 9 contract tests in `dispatch.test.ts` (RED via missing imports) lock every signature, Redis key prefix, TTL, gate ordering, and console event name that Plans 04-02 and 04-03 must satisfy. The pure-function `snippetMatter` helper (Decision 4) ships GREEN this plan so the 1h and 24h templates can import it directly when 04-02 lands.

## What Shipped

### `src/lib/email-reminders/format-matter.ts` (GREEN)

Pure function `snippetMatter(matterDescription: string): string` per 04-CONTEXT.md Decision 4:
1. Trim + collapse `\r\n`/whitespace runs to single spaces.
2. Split on `/[.!?]\s/` → take first segment.
3. If first segment ≤ 120 chars → return it as-is (no trailing punctuation).
4. If first segment > 120 chars → `slice(0, 117) + "..."` (length exactly 120).
5. Empty/whitespace input → `""` (never throws).

Zero imports, zero side effects, zero `console.*` calls. The 1h and 24h templates (Plan 04-02) and the route handler (Plan 04-03) import it as-is.

### `src/lib/email-reminders/__tests__/format-matter.test.ts` (GREEN — 13 cases)

Covers all 11 plan-required edge cases plus 2 additions:
- Empty / whitespace-only input
- Single sentence terminated by `.`, `?`, `!`
- Multi-sentence (only first segment returned, no trailing punctuation)
- Multi-line input (`\n` → space)
- Exactly 120 chars no punctuation → verbatim, no ellipsis
- 121 chars no punctuation → truncated to exactly 120 with `...`
- 200-char first sentence → truncated to 120 with `...`
- Whitespace-run collapse
- `\r\n` line-ending normalisation (added)

### `src/lib/email-reminders/__tests__/dispatch.test.ts` (RED — 9 contract tests)

9 `describe` blocks, each pinned to a requirement ID, asserting the contract for Plans 04-02 and 04-03:

| # | Describe | Requirement | Asserts |
|---|----------|-------------|---------|
| 1 | scheduleEmailReminder — absent QSTASH_TOKEN | OPS-V1.1-01 | warns `email_reminder_skipped`/`no_qstash_token`, no redis.set, no publishJSON, no throw |
| 2 | scheduleEmailReminder — happy path | INFRA-02 | publishJSON `delay=3600`, redis.set `email-reminder:payment-abandonment-1h:sess-B = msg-qstash-1h` with `ex=10800` |
| 3 | cancelEmailReminder — idempotent | INFRA-06 | first call cancels + dels; second call no-ops (cancel called exactly once) |
| 4 | handleEmailReminderDelivery — gates run before NX | INFRA-04, INFRA-05 | redis.get(`payment-completed:`) + redis.get(`unsubscribe:`) BEFORE redis.set(`email-reminder-sent:...`, `{nx, ex:604800}`); resend.send AFTER NX-OK |
| 5 | handleEmailReminderDelivery — payment-completed gate | INFRA-04 | short-circuits with `email_reminder_skipped`/`payment_completed`; resend never called; NX-set never written |
| 6 | handleEmailReminderDelivery — unsubscribe gate | INFRA-04 | short-circuits with `email_reminder_skipped`/`unsubscribed`; resend never called |
| 7 | unsubscribe HMAC — sign/verify round-trip | INFRA-07 | base64url-shaped (no `=`/`+`/`/`); verify returns true |
| 8 | unsubscribe HMAC — wrong secret AND wrong session | INFRA-07 | both reject with false; correct secret + session still verifies true |
| 9 | absent UNSUBSCRIBE_SECRET + activity-log isolation | OPS-V1.1-01, Decision 3 | sign returns null + warns; logActivity does NOT throw on redis.lpush failure + warns `activity_log_failed` |

Mocks (7 total, external boundaries only):
- `@/lib/kv` — redis stub with `get`, `set`, `del`, `lpush`, `expire`
- `@upstash/qstash` — Client class with `publishJSON` + `messages.cancel` spies
- `@upstash/qstash/nextjs` — `verifySignatureAppRouter` HOC passthrough (lets tests reach inner handler)
- `resend` — Resend class with `emails.send` spy
- `@/lib/email/assert-no-tracking` — `assertNoResendTracking` resolves
- `@/lib/intake` — `getIntake` returns fixture intake
- `@/lib/digest/activity-log` — `vi.importActual` passthrough (so test 9 exercises real isolation when 04-02 lands the module)

## Confirmed Redis Key Prefixes (locked in tests)

Plans 04-02 and 04-03 must match these EXACTLY — drift fails the contract suite:

| Prefix | TTL | Purpose | First-touched in |
|--------|-----|---------|------------------|
| `email-reminder:{type}:{sessionId}` | `delaySeconds + 7200` (= **10800** when delaySeconds=3600) | Cancel-lookup (stores QStash messageId) | Plan 04-02 schedule |
| `email-reminder-sent:{type}:{sessionId}` | **604800** (= 7 × 24 × 3600) | Delivery NX dedup | Plan 04-03 delivery handler |
| `payment-completed:{sessionId}` | 93600 (= 26h, ROADMAP) — **not asserted in this plan** | Cancellation-state gate (read at delivery) | Plan 04-02 handlePaid mutation |
| `unsubscribe:{sessionId}` | 2592000 (= 30d, Decision 2) — **not asserted in this plan** | Visitor opt-out gate | Plan 04-03 unsubscribe route |
| `activity:{YYYY-MM-DD-AEST}` | 1209600 (= 14d, DIG-01) — **not asserted in this plan** | Per-day activity list | Plan 04-02 logActivity helper |

## TTL Literals Status

| TTL | Value | Asserted in this plan? | Where it'll be supplied |
|-----|-------|------------------------|-------------------------|
| `delaySeconds + 7200` | 10800 (test 2) | ✅ Yes | Plan 04-02 dispatch.ts |
| `7 * 24 * 3600` | 604800 (test 4) | ✅ Yes | Plan 04-03 route.ts |
| `26 * 3600` | 93600 | ❌ No | Plan 04-02 handlePaid mutation |
| `30 * 24 * 3600` | 2592000 | ❌ No | Plan 04-03 unsubscribe route |
| `14 * 24 * 3600` | 1209600 | ❌ No | Plan 04-02 activity-log.ts |

## Confirmed Console Event Names (locked in tests)

- `email_reminder_skipped` (with reasons: `no_qstash_token`, `payment_completed`, `unsubscribed`)
- `email_reminder_scheduled`
- `activity_log_failed`

(Reserved for OPS-V1.1-02 in 04-03 but not asserted here: `email_reminder_sent`, `email_reminder_send_failed`.)

## TDD Gate Compliance

Plan-level type is `execute`, not `tdd`, but each task carries `tdd="true"`:

- **Task 1 (format-matter):** RED gate — wrote `format-matter.test.ts` first, ran vitest, confirmed `Cannot find module '../format-matter'`. GREEN gate — implemented `format-matter.ts`, all 13 tests pass. Both committed in a single commit `feat(04-01): add format-matter helper...` (RED + GREEN combined since the helper is trivial — no separate test commit needed for a pure 35-line function).
- **Task 2 (dispatch.test.ts):** RED gate — wrote 9 contract tests; vitest output confirms `Cannot find module '/src/lib/email-reminders/dispatch'`. GREEN is INTENTIONALLY deferred to plans 04-02 + 04-03. Committed as `test(04-01): add 9 RED contract tests...`.

## Verification Run

```
$ npx vitest run src/lib/email-reminders/__tests__/format-matter.test.ts
Test Files  1 passed (1)
Tests  13 passed (13)

$ npx vitest run src/lib/email-reminders/__tests__/dispatch.test.ts
FAIL  Cannot find module '/src/lib/email-reminders/dispatch' (intentional RED)

$ npx vitest run src/lib/sms/__tests__/
Test Files  2 passed (2)
Tests  11 passed (11)   # v1.0 regression — clean
```

## Deviations from Plan

**1. [Rule 1 - Test design adjustment] Mocked `@/lib/digest/activity-log` via `vi.importActual` passthrough instead of `vi.fn()` stub**

- **Found during:** Task 2 acceptance-criterion verification (`vi.mock(` count must be ≥7).
- **Issue:** The plan's `<action>` skeleton showed `vi.mock("@/lib/digest/activity-log", () => ({ logActivity: logActivityMock }))` — but test 9 part 2 asserts that `logActivity` does NOT throw when `redis.lpush` fails AND that `console.warn` fires with `event: "activity_log_failed"`. A `vi.fn()` stub records the call but never exercises the real catch branch — the assertion would never see `activity_log_failed` once Plan 04-02's real module lands.
- **Fix:** Replaced the stub with `vi.importActual` passthrough. When Plan 04-02 ships the real `logActivity`, the test naturally exercises its real isolation behaviour (lpush throws → caught → warn emitted) without further test edits. This is what the plan's INTENT is; the skeleton's stub form was an oversight.
- **Files modified:** `src/lib/email-reminders/__tests__/dispatch.test.ts`
- **Commit:** `1886b67`

**2. [Rule 2 - Coverage strengthening] Added 2 extra test cases to format-matter.test.ts (13 total instead of plan's 11)**

- **Found during:** Task 1 review against Decision 4's "Edge cases tests must cover" list.
- **Issue:** Plan listed 8 edge cases + 11 `it()` minimum, but two important cases weren't enumerated: (a) 121-char no-punctuation input (the boundary case that triggers truncation, distinct from the 200-char case), (b) `\r\n` line-ending normalisation (Decision 4 mandates collapse but no test asserted it).
- **Fix:** Added both cases. Acceptance criterion (`it() count >= 11`) still satisfied.
- **Files modified:** `src/lib/email-reminders/__tests__/format-matter.test.ts`
- **Commit:** `068fe24`

No other deviations. No auth gates encountered. No architectural questions raised.

## Authentication Gates

None — both tasks are pure code/test additions; no external services touched.

## Known Stubs

None. format-matter is a finished pure helper. dispatch.test.ts contains placeholder imports that will resolve when Plans 04-02 and 04-03 ship — those are the INTENT (RED state), not stubs.

## Threat Flags

None new. Plan 04-01 ships only test fixtures and a pure string helper. The HMAC sign/verify, gate logic, and Redis writes are contract assertions in this plan — implementation lands in Plans 04-02 + 04-03 where the threat model already covers them (INFRA-04, INFRA-05, INFRA-07).

## Self-Check: PASSED

- ✅ `src/lib/email-reminders/format-matter.ts` — exists, pure function, all acceptance greps pass
- ✅ `src/lib/email-reminders/__tests__/format-matter.test.ts` — 13 GREEN cases
- ✅ `src/lib/email-reminders/__tests__/dispatch.test.ts` — 9 describe blocks, 7 vi.mock calls, RED via missing imports (`Cannot find module '../dispatch'`)
- ✅ Locked TTLs `10800` and `604800` present in test file
- ✅ All 4 locked Redis key prefixes present in test file
- ✅ All 3 locked console event names present in test file
- ✅ All 6 requirement IDs (INFRA-02, INFRA-04, INFRA-05, INFRA-06, INFRA-07, OPS-V1.1-01) referenced in describe labels
- ✅ v1.0 SMS reminder tests still pass (11/11) — no regression
- ✅ Commit `068fe24` (`feat(04-01): add format-matter helper...`) — verified via `git log`
- ✅ Commit `1886b67` (`test(04-01): add 9 RED contract tests...`) — verified via `git log`

```
$ git log --oneline | head -3
1886b67 test(04-01): add 9 RED contract tests for email-reminder dispatch framework
068fe24 feat(04-01): add format-matter helper for re-engagement email snippets
bb52908 docs(04): plan Phase 4 — re-engagement framework + payment abandonment...
```

---

*Plan 04-01 complete. Plans 04-02 (framework + activity-log + handlePaid wiring + reengagement-payment.tsx + copy.ts) and 04-03 (delivery route + unsubscribe route + branded /unsubscribed page + select-urgency wiring) are unblocked. Both must turn dispatch.test.ts GREEN with zero test edits.*
