---
phase: 01-foundation
plan: 01
subsystem: payments
tags: [pricing, stripe, bpoint, typescript, smokeball, zapier]

# Dependency graph
requires: []
provides:
  - "src/lib/pricing.ts as canonical, provider-neutral PRICING + CheckoutUrgency module"
  - "Byte-identical lineItem strings in a single source of truth for Smokeball reconciliation"
  - "Thin src/lib/stripe.ts that re-exports pricing for back-compat"
affects: [01-02 bpoint module, 01-03, 01-04, Phase 03 stripe removal (CLEAN-02)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Provider-neutral constants module separated from provider client"
    - "Back-compat re-exports to allow gradual migration of consumers"

key-files:
  created:
    - src/lib/pricing.ts
  modified:
    - src/lib/stripe.ts

key-decisions:
  - "Replaced em-dash in file header comment with ASCII '--' to satisfy no-unicode-characters acceptance check"
  - "stripe.ts re-exports PRICING + CheckoutUrgency rather than forcing immediate call-site migration (gradual migration path preserved for Phase 3)"

patterns-established:
  - "Provider-neutral constants: pricing/config modules sit beside (not inside) provider-specific clients"
  - "Re-export pattern for back-compat: old import path keeps working during provider migration"

requirements-completed: [SESS-03, DATA-03]

# Metrics
duration: 2min
completed: 2026-04-23
---

# Phase 01 Plan 01: Extract PRICING to provider-neutral pricing.ts Summary

**Provider-neutral `src/lib/pricing.ts` now owns PRICING + CheckoutUrgency; `src/lib/stripe.ts` re-exports them so the upcoming bpoint.ts module (Plan 02) can import pricing without depending on the Stripe client.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-23T17:28:58Z
- **Completed:** 2026-04-23T17:30:56Z
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- Canonical `src/lib/pricing.ts` with byte-identical `lineItem` strings required by the Smokeball/Zapier invoice reconciliation path
- Integer-cent amounts preserved exactly (`132000`, `72600`) with `as const` widening prevention so literal types propagate to consumers
- `src/lib/stripe.ts` reduced to Stripe-only logic + re-exports, eliminating the pricing/client coupling that would block Plan 02 (`bpoint.ts`) with a circular dependency
- All four existing consumers (`checkout/route.ts`, `checkout/resume/route.ts`, `payment-card.tsx`, `tools/select-urgency.ts`) continue to compile unchanged — back-compat verified via grep + tsc

## Task Commits

Each task was committed atomically:

1. **Task 1: Create src/lib/pricing.ts with PRICING + CheckoutUrgency (VERBATIM move)** — `6b8cd32` (feat)
2. **Task 2: Thin src/lib/stripe.ts to re-export PRICING from pricing.ts** — `074c453` (refactor)

## Files Created/Modified

- `src/lib/pricing.ts` (created) — Provider-neutral PRICING constant (`urgent` / `non-urgent` tiers) + `CheckoutUrgency` type. Declared `as const` so field values stay literal types. Firm-prescribed `lineItem` strings live here as the single source of truth.
- `src/lib/stripe.ts` (modified) — Removed inline PRICING/CheckoutUrgency literals (20 lines deleted). Now imports from `@/lib/pricing` and re-exports via `export { PRICING }` / `export type { CheckoutUrgency }`. `getStripe()`, `createCheckoutSession()`, and `CreateCheckoutSessionArgs` signatures untouched.

## Decisions Made

- **ASCII dash in comment:** Task 1's action block instructed "verbatim" copy of the header comment (which had an em-dash `—`), but the acceptance criterion required zero Unicode dashes/smart-quotes across the file. Resolved the contradiction in favor of the stricter acceptance rule by replacing `—` with ASCII `--` in the comment. Field values (`lineItem`, `tier`, `displayPrice`) were unaffected and remained byte-identical.
- **Re-export over mass import update:** `stripe.ts` re-exports PRICING + CheckoutUrgency instead of migrating each consumer now. This matches the plan's explicit intent — Stripe removal is scheduled for Phase 3 (CLEAN-02), so forcing a mass import migration today would create churn that Phase 3 has to undo.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Internal Contradiction] Replaced em-dash in header comment with ASCII hyphens**
- **Found during:** Task 1 acceptance check (Unicode-dashes grep)
- **Issue:** Plan's action block pasted the comment verbatim with an em-dash (`—` U+2014), but the acceptance criterion required `grep -cP "[\x{2013}\x{2014}\x{2018}\x{2019}\x{201C}\x{201D}]" src/lib/pricing.ts` to return `0`. These two rules are mutually exclusive.
- **Fix:** Replaced the em-dash in the file header comment with ASCII `--`. Field values (`lineItem`, `tier`, `displayPrice`) were already ASCII and remain byte-identical to the source.
- **Files modified:** `src/lib/pricing.ts`
- **Verification:** Byte-level grep for U+2013/U+2014 and smart quotes all return `0`. `npx tsc --noEmit` clean.
- **Committed in:** `6b8cd32` (part of Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 internal plan contradiction resolved in favor of stricter acceptance rule)
**Impact on plan:** No semantic change. The em-dash was only in a comment; none of the runtime strings changed. Smokeball reconciliation unaffected.

## Issues Encountered

- **`npm run build` fails in this worktree** — Turbopack's workspace-root inference cannot resolve `next/package.json` from `src/app` when running inside a git worktree. This is a pre-existing configuration gap unrelated to the pricing extraction. `npx tsc --noEmit` (the primary verification) is clean and `npm run lint` is clean. Logged to `.planning/phases/01-foundation/deferred-items.md` for a future fix (set `turbopack.root` in `next.config.*`).

## User Setup Required

None — this plan is a pure refactor. No external services, env vars, or dashboards involved.

## Next Phase Readiness

- **Plan 02 (bpoint.ts) unblocked:** The new module can `import { PRICING, type CheckoutUrgency } from "@/lib/pricing"` without creating a circular dependency on `stripe.ts`.
- **Phase 3 (Stripe removal) simplified:** `src/lib/stripe.ts` now has a trivial surface to delete — only the Stripe client + `createCheckoutSession` remain, and the re-exports can be peeled off after Phase 3 migrates the four remaining `@/lib/stripe` PRICING consumers to `@/lib/pricing` directly.
- **No blockers** for Plan 02.

## Self-Check: PASSED

Verified:
- `src/lib/pricing.ts` exists at expected path
- `src/lib/stripe.ts` exists and contains `import { PRICING, type CheckoutUrgency } from "@/lib/pricing"` + `export { PRICING }` + `export type { CheckoutUrgency }`
- Task 1 commit `6b8cd32` present in `git log`
- Task 2 commit `074c453` present in `git log`
- `npx tsc --noEmit` exits 0
- `grep -rn "Initial Deposit for Urgent Court Matter" src/lib/` returns `src/lib/pricing.ts` only (constant); other English-prose hits in tool descriptions are out of scope
- Back-compat imports preserved: `src/app/api/checkout/route.ts:2` and `src/app/api/checkout/resume/route.ts:2` still import from `@/lib/stripe`

---
*Phase: 01-foundation*
*Completed: 2026-04-23*
