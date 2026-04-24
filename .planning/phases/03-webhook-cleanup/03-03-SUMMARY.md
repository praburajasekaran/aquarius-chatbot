---
phase: 03-webhook-cleanup
plan: 03
subsystem: payments
tags: [bpoint, stripe-removal, nextjs, intake, authkey, resume-flow]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "createAuthKey BPoint client + intake.bpointTxnNumber field + provider-neutral @/lib/pricing"
  - phase: 03-webhook-cleanup/03-02
    provides: "CreateAuthKeyArgs.webhookUrlBase field + @/lib/bpoint WebHookUrl serialization"
provides:
  - "GET /api/checkout/resume ported to BPoint AuthKey refresh (zero Stripe imports)"
  - "src/ tree cleared of all @/lib/stripe importers except Plan-04 deletion targets"
  - "Plan 04 unblocked: src/lib/stripe.ts can now be deleted without breaking TypeScript compilation"
affects: [03-04-cleanup, future-bpoint-work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Always-create-fresh-AuthKey on resume (BPoint v2 has no retrieve-by-AuthKey API)"
    - "Resume route as thin redirect to /?payment=resume — chat-widget re-mounts PaymentCard against the fresh AuthKey pulled from intake"
    - "createAuthKey failures in resume route downgrade to /?expired=1 redirect (never 5xx)"
    - "Provider-neutral @/lib/pricing import for all downstream callers; @/lib/stripe re-exports remain only for files scheduled for deletion"

key-files:
  created: []
  modified:
    - "src/app/api/checkout/resume/route.ts"
    - "src/lib/tools/select-urgency.ts"

key-decisions:
  - "Plan 03-03: Resume route always issues a fresh AuthKey — no TTL-reuse branch, because BPoint exposes no AuthKey status check (locked in 03-CONTEXT.md)"
  - "Plan 03-03: Resume success redirects to /?payment=resume (not directly to a BPoint URL) so the chat widget's PaymentCard re-mounts with the new AuthKey from intake"
  - "Plan 03-03: webhookUrlBase threaded through on resume so a recovered half-finished payment still receives the server-to-server BPoint callback"
  - "Plan 03-03: selectUrgency PRICING import redirected from @/lib/stripe to @/lib/pricing — closes an overlooked back-compat import that would have blocked Plan 04's stripe.ts deletion"

patterns-established:
  - "Resume-flow pattern: sessionId -> getIntake -> createAuthKey -> updateIntake(bpointTxnNumber) -> redirect(/?payment=resume). Any failure in the createAuthKey/updateIntake step degrades to /?expired=1."
  - "Cleanup sequencing: all non-deletion-target files must be scrubbed of @/lib/stripe imports before Plan 04 deletes the re-export shim"

requirements-completed: [CLEAN-02]

# Metrics
duration: ~2min
completed: 2026-04-24
---

# Phase 3 Plan 3: Port checkout/resume to BPoint Summary

**GET /api/checkout/resume now uses BPoint createAuthKey exclusively; last non-deletion-target @/lib/stripe caller (select-urgency.ts) also redirected to @/lib/pricing, fully unblocking Plan 04's Stripe deletion.**

## Performance

- **Duration:** ~2min
- **Started:** 2026-04-24T06:10:40Z
- **Completed:** 2026-04-24T06:12:30Z
- **Tasks:** 1 planned (+ 1 Rule-3 auto-fix deviation)
- **Files modified:** 2

## Accomplishments

- `GET /api/checkout/resume` is BPoint-only: no Stripe imports, no `getStripe()`, no `createCheckoutSession`; it calls `createAuthKey({ sessionId, urgency, redirectionUrlBase, webhookUrlBase })`, persists the fresh AuthKey via `updateIntake(sessionId, { bpointTxnNumber: authKey })`, and redirects to `/?payment=resume`.
- createAuthKey failure path collapses to `/?expired=1` — no 5xx ever escapes the resume route, matching the locked CONTEXT decision.
- `src/lib/tools/select-urgency.ts` PRICING import redirected from `@/lib/stripe` -> `@/lib/pricing` (provider-neutral source since Phase 01). This was an overlooked back-compat import that would have broken Plan 04's `rm src/lib/stripe.ts`.
- Post-change `grep -rln "@/lib/stripe" src/` lists exactly one file: `src/app/api/webhooks/stripe/route.ts` (Plan 04 deletion target). The second Plan-04 deletion target, `src/lib/stripe.ts`, is not an importer of itself so it does not appear in the grep — that is expected and correct.
- Full test suite: 49/49 green. `npm run build` compiles cleanly. `npm run lint` returns the same single pre-existing warning in `tests/chat-widget.test.tsx` as before the change (unrelated, out of scope).

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace resume route with BPoint port** - `3abb3c1` (feat)
2. **Deviation (Rule 3): Redirect selectUrgency PRICING import off @/lib/stripe** - `e602ca8` (fix)

**Plan metadata:** forthcoming final commit (docs: complete plan)

## Files Created/Modified

- `src/app/api/checkout/resume/route.ts` — fully rewritten. Before: 50 lines, imported `{ createCheckoutSession, getStripe } from "@/lib/stripe"` plus `{ getIntake, updateIntake } from "@/lib/intake"`, contained branching Stripe session reuse plus fresh session creation plus a direct redirect to the Stripe-hosted checkout URL. After: 55 lines, imports `{ createAuthKey } from "@/lib/bpoint"` plus `{ getIntake, updateIntake } from "@/lib/intake"`; single straight-line try/catch around `createAuthKey` + `updateIntake` + redirect to `/?payment=resume`; failure redirects to `/?expired=1`; preserves `runtime = "nodejs"` and `dynamic = "force-dynamic"`.
- `src/lib/tools/select-urgency.ts` — single-line import swap: `import { PRICING } from "@/lib/stripe"` -> `import { PRICING } from "@/lib/pricing"`. Runtime behavior unchanged (pricing constants are identical; `@/lib/stripe` only re-exported `@/lib/pricing`).

## Decisions Made

- **Always-create-fresh AuthKey on resume** (already locked in 03-CONTEXT.md): BPoint v2 exposes no retrieve-by-AuthKey API, so there is no way to check whether the prior AuthKey on `intake.bpointTxnNumber` is still inside its 30-min TTL. Safest equivalent pattern is to always issue a new one. BPoint's own side is stateless about the old AuthKey — if the user never completed payment, the old AuthKey simply decays.
- **Redirect to `/?payment=resume`, not directly to a BPoint iframe URL**: keeps the resume flow symmetric with the primary checkout flow — the chat widget is responsible for rendering PaymentCard against `intake.bpointTxnNumber`, whether that value came from the initial `POST /api/checkout` call or from the resume refresh.
- **Thread `webhookUrlBase` through on resume**: without it, the refreshed AuthKey would register no BPoint server-to-server callback, so a payment completed on the resumed attempt would depend solely on the browser-redirect confirm path. Keeping webhook registration symmetric between initial and resumed AuthKeys is the conservative choice.
- **Fix selectUrgency import as part of this plan, not defer**: the plan's own checkpoint check (lines 203-205 of 03-03-PLAN.md) explicitly requires that no non-deletion-target file import `@/lib/stripe` at plan end. This is not out-of-scope scope creep — it is literally a gating condition of this plan's success criteria ("CLEAN-02 partial").

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Redirected selectUrgency PRICING import from @/lib/stripe to @/lib/pricing**
- **Found during:** Task 1 (resume-route port) — checkpoint grep after task completion
- **Issue:** `src/lib/tools/select-urgency.ts:3` imported `PRICING` from `@/lib/stripe`. The plan's own checkpoint check mandates zero non-deletion-target importers of `@/lib/stripe` so Plan 04 can safely delete the file. This import was a residue from Phase 01-foundation when `PRICING` was migrated to `@/lib/pricing` and `@/lib/stripe` was left as a temporary back-compat re-export.
- **Fix:** Single-line import swap to `@/lib/pricing` (same symbol, identical values, now sourced directly from the provider-neutral module). No runtime behavior change.
- **Files modified:** `src/lib/tools/select-urgency.ts`
- **Verification:** `grep -rln "@/lib/stripe" src/` now returns only `src/app/api/webhooks/stripe/route.ts` (Plan 04 deletion target). `npm run build && npm run lint && npm test` all green (49/49 tests).
- **Committed in:** `e602ca8`

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking: required by this plan's own acceptance criteria).
**Impact on plan:** No scope creep. The plan's checkpoint check explicitly lists this condition as a gate; executing it here is faithful to the plan, not beyond it.

## Issues Encountered

None.

## User Setup Required

None.

## Next Phase Readiness

Plan 04 (Stripe file deletion + Redis key prefix rename + env var scrub + package uninstall) is fully unblocked:

- `src/lib/stripe.ts` has zero remaining importers (confirmed by grep).
- `src/app/api/webhooks/stripe/route.ts` is the only other `@/lib/stripe` consumer and is itself a Plan-04 deletion target.
- 49/49 tests green; production build compiles; lint clean except for the single pre-existing warning in `tests/chat-widget.test.tsx` (unrelated).

Operational note (already flagged in 03-RESEARCH.md Open Question 3): `NEXT_PUBLIC_URL` must be correctly set per Vercel environment before UAT — a preview deploy pointing at the production URL would cause BPoint to POST the webhook to prod. Not a Plan-04 code concern, but worth surfacing for the deploy step.

## Self-Check: PASSED

- FOUND: `src/app/api/checkout/resume/route.ts`
- FOUND: `src/lib/tools/select-urgency.ts`
- FOUND: `.planning/phases/03-webhook-cleanup/03-03-SUMMARY.md`
- FOUND commit `3abb3c1` (Task 1 resume port)
- FOUND commit `e602ca8` (Deviation fix: selectUrgency import)

---
*Phase: 03-webhook-cleanup*
*Completed: 2026-04-24*
