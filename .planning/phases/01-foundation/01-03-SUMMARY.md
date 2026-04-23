---
phase: 01-foundation
plan: 03
subsystem: payments
tags: [typescript, redis, upstash, resend, stripe, bpoint, rename, field-migration]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: Plan 01 (pricing.ts extraction) — provider-neutral pricing constants so Plan 03's rename doesn't collide with pricing strings
provides:
  - bpointTxnNumber field across SessionData, IntakeRecord, email senders, CLI script, and all non-checkout routes
  - Zapier transcript row position preserved (label text only changed — row count 7 intact)
  - `npx tsc --noEmit` green baseline (DATA-01 gate) for Plan 04 to build on
affects: [01-04, 02-ui-swap, 03-bpoint-webhook]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Field rename executed as surgical find-and-replace (no structural changes) — preserves Zapier HTML contract"
    - "Phase-1 soak: Stripe session IDs continue to populate the bpointTxnNumber field during the transition; Plan 04 switches the write-site to BPoint AuthKeys"

key-files:
  created: []
  modified:
    - src/types/index.ts
    - src/lib/kv.ts
    - src/lib/intake.ts
    - src/lib/resend.ts
    - src/scripts/revoke-upload-token.ts
    - src/app/api/checkout/resume/route.ts
    - src/app/api/webhooks/stripe/route.ts
    - src/app/api/webhooks/calendly/route.ts
    - src/app/api/checkout/route.ts

key-decisions:
  - "Renamed the persisted payment-identifier field stripeSessionId -> bpointTxnNumber across all 9 call-sites in one plan to keep TypeScript green after Task 3"
  - "checkout/route.ts edited in only 2 places (updateIntake key + console.error text) — createCheckoutSession call and clientSecret response shape deferred to Plan 04 to avoid merge conflicts"
  - "Stripe webhook Redis dedupe-key prefix stripe-session: kept unchanged — it is an internal key, not a persisted field, and Phase 3 deletes the whole webhook file"
  - "Transcript email HTML row at line 40 changed label Stripe Session -> BPoint Transaction while preserving 7-row table structure (Zapier parser contract DATA-02)"
  - "paymentAmount: number | null in SessionData left untouched (DATA-03 already compliant with integer-cents schema)"

patterns-established:
  - "Field-rename playbook: types -> persistence defaults -> email/HTML labels -> route call-sites, then tsc --noEmit as the gate"
  - "Zapier HTML row count invariant verified by pre/post grep -c <tr> (before=18, after=18)"

requirements-completed: [DATA-01, DATA-02, DATA-03]

# Metrics
duration: 2min
completed: 2026-04-23
---

# Phase 1 Plan 3: BPoint Field Rename Summary

**Renamed stripeSessionId to bpointTxnNumber across 9 files (types, Redis session store, intake, email senders, CLI script, and 4 API route handlers) with Zapier transcript row structure preserved and TypeScript clean.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-23T17:33:42Z
- **Completed:** 2026-04-23T17:35:32Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments
- Field `stripeSessionId` fully eradicated from `src/` (23 new `bpointTxnNumber` references replace it)
- `npx tsc --noEmit` exits 0 — the DATA-01 acceptance gate is met
- Zapier transcript email HTML row count preserved at 18 `<tr>` (7 in transcript table), label text updated to `BPoint Transaction` / `BPoint transaction` without row reordering
- `paymentAmount: number | null` integer-cents schema untouched (DATA-03)
- `src/app/api/checkout/route.ts` touched only in the two specified sites (updateIntake key + console.error), leaving `createCheckoutSession` and `clientSecret` response shape intact for Plan 04

## Task Commits

1. **Task 1: Rename in types, Redis, intake, Resend, and CLI script** - `7aff426` (refactor)
2. **Task 2: Rename in route handlers — checkout/resume, webhooks/stripe, webhooks/calendly** - `fb6c0f8` (refactor)
3. **Task 3: Field-name swap in checkout/route.ts to unblock compiler** - `7162344` (refactor)

**Plan metadata:** pending final commit (SUMMARY + STATE + ROADMAP)

## Files Created/Modified
- `src/types/index.ts` — SessionData.bpointTxnNumber (seed of the rename)
- `src/lib/kv.ts` — createSession default value updated
- `src/lib/intake.ts` — IntakeRecord field + createIntake Omit + default (4 sites)
- `src/lib/resend.ts` — sendTranscriptEmail + sendBookingNotificationEmail param renames and HTML row label updates (6 sites across 2 email functions)
- `src/scripts/revoke-upload-token.ts` — doc comment + usage string updated; `sessionId` variable + `--session` CLI flag unchanged by design
- `src/app/api/checkout/resume/route.ts` — reads `intake.bpointTxnNumber`, writes `{ bpointTxnNumber: fresh.id }` (3 sites)
- `src/app/api/webhooks/stripe/route.ts` — updateSession, sendTranscriptEmail, console.error log (3 sites); `stripe-session:` Redis dedupe-key prefix preserved as internal key
- `src/app/api/webhooks/calendly/route.ts` — sendBookingNotificationEmail payload (1 site)
- `src/app/api/checkout/route.ts` — updateIntake payload key + console.error text only (2 sites); Stripe call + clientSecret response shape deferred to Plan 04

## Decisions Made

- **Stripe-named values in a BPoint-named field during soak:** `checkout/route.ts` and the Stripe webhook still write Stripe session IDs into the renamed `bpointTxnNumber` field. This is intentional per the CONTEXT.md "update in-place during soak" decision — Plan 04 swaps the write-site to BPoint AuthKeys and Phase 3 deletes the Stripe webhook entirely.
- **Redis dedupe-key prefix `stripe-session:` left as-is** — it is internal to the Stripe webhook's event-stream dedup, not a persisted type identifier, and the whole file is scheduled for deletion in Phase 3.
- **CLI script variable `sessionId` retained** — the CLI flag is `--session`, so only the `<stripeSessionId>` placeholder text in doc comment and usage string changed.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- DATA-01 gate met: `grep -rn "stripeSessionId" src/` is empty and `npx tsc --noEmit` exits 0
- DATA-02 preserved: Zapier transcript row count stable (7 transcript rows / 18 total `<tr>`), lineItem strings intact
- DATA-03 preserved: `paymentAmount: number | null` unchanged
- Plan 04 can now rewrite `src/app/api/checkout/route.ts` to call BPoint and return `{ authKey }` — the field it writes (`bpointTxnNumber`) is already in place in `IntakeRecord`

## Self-Check

Created files:
- FOUND: `.planning/phases/01-foundation/01-03-SUMMARY.md`

Task commits:
- FOUND: `7aff426` (Task 1)
- FOUND: `fb6c0f8` (Task 2)
- FOUND: `7162344` (Task 3)

Invariants:
- `grep -rn "stripeSessionId" src/` returns empty: CONFIRMED
- `npx tsc --noEmit` exits 0: CONFIRMED
- `<tr>` count in `src/lib/resend.ts` stable at 18: CONFIRMED
- `paymentAmount: number | null` in `src/types/index.ts`: CONFIRMED

## Self-Check: PASSED

---
*Phase: 01-foundation*
*Completed: 2026-04-23*
