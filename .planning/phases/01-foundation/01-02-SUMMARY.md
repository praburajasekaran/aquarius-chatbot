---
phase: 01-foundation
plan: 02
subsystem: payments
tags: [bpoint, authkey, basic-auth, typescript, nextjs, fetch]

requires:
  - phase: 01-foundation
    provides: "PRICING constant and CheckoutUrgency type from src/lib/pricing.ts (Plan 01-01)"
provides:
  - "createAuthKey(args): Promise<string> — posts a BPoint v5 AuthKey request and returns the UUID"
  - "CreateAuthKeyArgs interface — { sessionId, urgency, redirectionUrlBase }"
  - "Pipe-separated Basic Auth header builder (username|merchantNumber:password)"
  - "Per-call BPOINT_ENV resolution (UAT vs prod base URL, IsTestTxn flag)"
affects:
  - "01-foundation Plan 04 (/api/checkout route — first caller)"
  - "03 webhook phase (session reconciliation uses same env gating pattern)"

tech-stack:
  added:
    - "BPoint v5 AuthKey endpoint integration (CBA/Linkly hosted payment page)"
  patterns:
    - "Per-call env evaluation via getBpointConfig() to avoid Vercel bundle-time inlining"
    - "Pipe-separator Basic Auth header (non-standard, mandatory per BPoint v5)"
    - "Integer-cent Amount pass-through (no decimal conversion)"
    - "Lazy config object built inside each call (mirrors stripe.ts lazy-singleton pattern but intentionally NOT memoised)"

key-files:
  created:
    - "src/lib/bpoint.ts"
  modified: []

key-decisions:
  - "Read BPOINT_ENV inside createAuthKey on every call (not cached at module load) — prevents Vercel build-time value pinning"
  - "Build auth header as Buffer.from(`${username}|${merchantNumber}:${password}`).toString('base64') — the pipe between username and merchantNumber is mandatory BPoint v5 spec (not standard user:pass)"
  - "Fixed ExpiryInMinutes: 30 on the AuthKey request — matches existing Stripe checkout 30-minute TTL for Redis session consistency"
  - "No retry / backoff / Zod response validation in Phase 1 — single-attempt fetch; Plan 04 integration test will surface any ExpiryInMinutes rejection"
  - "Default to UAT base URL (bpoint.uat.linkly.com.au) when BPOINT_ENV is unset, empty, or any non-'prod' value — fail-safe to test mode"

patterns-established:
  - "Non-standard Basic Auth assembly via Buffer.from(...).toString('base64') — avoids btoa() unreliability on Node runtime"
  - "Bracket-prefixed error logs ([bpoint] ...) — matches codebase convention"
  - "Named exports only; no default export"

requirements-completed: [SESS-01, SESS-02, SESS-04, SESS-05]

duration: 1min
completed: 2026-04-23
---

# Phase 01 Plan 02: BPoint AuthKey Client Summary

**Server-side BPoint v5 AuthKey creation client with pipe-separated Basic Auth header, per-call IsTestTxn evaluation from BPOINT_ENV, and integer-cent Amount pass-through to the BPoint /txns/authkey endpoint.**

## Performance

- **Duration:** 1 min
- **Started:** 2026-04-23T17:33:30Z
- **Completed:** 2026-04-23T17:34:32Z
- **Tasks:** 1
- **Files modified:** 1 (1 created)

## Accomplishments

- `src/lib/bpoint.ts` compiles cleanly with `npx tsc --noEmit` (no errors in the new file)
- Exports `createAuthKey(args): Promise<string>` and `CreateAuthKeyArgs` interface — the single surface Plan 04 needs
- Basic Auth header assembled as `username|merchantNumber:password` with the mandatory pipe separator (BPoint v5 non-standard spec)
- `BPOINT_ENV` read inside `getBpointConfig()` on every call — no module-level caching, no Vercel bundle-time inlining risk
- UAT base URL defaults to `https://bpoint.uat.linkly.com.au/webapi/v2`; prod resolves to `https://www.bpoint.com.au/webapi/v2`
- `Amount` posted as integer cents straight from `PRICING` (132000 urgent / 72600 non-urgent) — no decimal conversion
- Missing `BPOINT_API_USERNAME`, `BPOINT_API_PASSWORD`, or `BPOINT_MERCHANT_NUMBER` throw descriptive errors at call time, not load time
- Fixed `ExpiryInMinutes: 30` matches Stripe's existing 30-minute checkout TTL for session-store consistency

## Task Commits

Each task was committed atomically:

1. **Task 1: Create src/lib/bpoint.ts with getBpointConfig() + createAuthKey()** - `2d19414` (feat)

**Plan metadata:** [pending final docs commit]

## Files Created/Modified

- `src/lib/bpoint.ts` — BPoint v5 AuthKey client: `createAuthKey` + `CreateAuthKeyArgs` + internal `getBpointConfig` / `buildBpointAuthHeader`. 104 lines.

## Decisions Made

- **Per-call env evaluation (not module-level const):** `getBpointConfig()` is called inside `createAuthKey` so `BPOINT_ENV` changes take effect on the next request. Prevents Vercel from inlining the value at build time and forcing a redeploy to flip prod/UAT.
- **Pipe separator is load-bearing:** `${username}|${merchantNumber}:${password}` — this is the most common BPoint integration failure per RESEARCH Pitfall 1. Using standard `user:pass` returns 401.
- **No retry / no Zod on response:** Single fetch attempt. Response typed as `{ AuthKey?: string }` with a null check. Plan 04 integration will surface any edge cases.
- **`ExpiryInMinutes: 30` left in request body:** RESEARCH Open Question 4 noted BPoint may reject this field. Removal is a one-line follow-up if Plan 04's curl contract test fails.

## Deviations from Plan

None — plan executed exactly as written. The `action` block's code was authoritative and landed verbatim.

**Out-of-scope pre-existing TypeScript errors** (NOT from this plan's changes): `npx tsc --noEmit` surfaces errors in `src/app/api/checkout/resume/route.ts`, `src/app/api/checkout/route.ts`, `src/app/api/webhooks/calendly/route.ts`, `src/app/api/webhooks/stripe/route.ts`, `src/lib/intake.ts`, and `src/lib/tools/select-urgency.ts` related to `stripeSessionId` / `bpointTxnNumber` fields on `IntakeRecord`. These belong to Plans 03 and 04 (session-type refactor + route migration) and are explicitly outside this plan's scope (which is strictly additive, `bpoint.ts` only). Logged here for traceability — no fixes applied per SCOPE BOUNDARY.

## Issues Encountered

None.

## User Setup Required

**External service configuration required before Plan 04 integration test.** See plan frontmatter `user_setup`:

- `BPOINT_API_USERNAME`, `BPOINT_API_PASSWORD`, `BPOINT_MERCHANT_NUMBER` must be set from BPoint Merchant Back Office (issued by CBA/Linkly)
- `BPOINT_ENV` defaults to UAT (unset) — set to `prod` only when going live
- Confirm whether firm has UAT credentials distinct from prod (tracked as STATE.md blocker)

Build succeeds without these — the module throws descriptively only when `createAuthKey` is invoked.

## Next Phase Readiness

- `src/lib/bpoint.ts` is ready to be imported by `src/app/api/checkout/route.ts` in Plan 04
- Signature `createAuthKey({ sessionId, urgency, redirectionUrlBase })` matches what Plan 04's refactor expects
- Returned AuthKey UUID can be embedded in the iframe src (Phase 2) as `https://{bpoint.uat.linkly.com.au|www.bpoint.com.au}/webapi/Payment?AuthKey=<uuid>`
- Outstanding blocker (inherited): UAT credentials from firm — captured in STATE.md

---
*Phase: 01-foundation*
*Completed: 2026-04-23*

## Self-Check: PASSED

- FOUND: src/lib/bpoint.ts
- FOUND: commit 2d19414 (feat(01-02): add BPoint v5 AuthKey creation client)
- FOUND: `export async function createAuthKey` in src/lib/bpoint.ts
- FOUND: `export interface CreateAuthKeyArgs` in src/lib/bpoint.ts
- FOUND: pipe-separator auth header `${username}|${merchantNumber}:${password}`
- FOUND: `process.env.BPOINT_ENV === "prod"` (per-call, inside getBpointConfig)
- FOUND: both UAT and prod `/webapi/v2` base URLs
- VERIFIED: `npx tsc --noEmit` — zero errors in src/lib/bpoint.ts (pre-existing errors in other files are out of scope)
- VERIFIED: no module-level `const` caching of BPOINT_ENV / isTestTxn / baseUrl
- VERIFIED: no `btoa(` usage; no `export default`
- VERIFIED: no callers yet (`grep -rn 'from "@/lib/bpoint"' src/` returns empty — Plan 04 adds the first one)
