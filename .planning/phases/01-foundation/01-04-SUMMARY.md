---
phase: 01-foundation
plan: 04
subsystem: payments
tags: [bpoint, authkey, checkout, route, nextjs, typescript, breaking-change]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: Plan 01-01 (PRICING constant in src/lib/pricing.ts), Plan 01-02 (createAuthKey in src/lib/bpoint.ts), Plan 01-03 (bpointTxnNumber field on IntakeRecord)
provides:
  - "POST /api/checkout returns { authKey } — BPoint AuthKey UUID (breaking change from { clientSecret })"
  - "BPoint 502 fail-closed response on AuthKey creation failure"
  - "AuthKey persisted to intake record via updateIntake(sessionId, { bpointTxnNumber: authKey })"
  - "Acceptance gate for Phase 1 roadmap success criteria #1, #2, #4, #5"
affects: [02-ui-swap, 03-bpoint-webhook]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Nested try/catch to isolate Redis persistence failures from BPoint payment session failures"
    - "Fail-closed HTTP 502 for upstream payment-provider errors with sanitized client-facing error message"
    - "Server-side log bracket-prefix `[checkout]` matches codebase convention"

key-files:
  created: []
  modified:
    - src/app/api/checkout/route.ts

key-decisions:
  - "No clientSecret compat alias — response is { authKey } only (per CONTEXT.md; PaymentCard UI breakage is expected and short-lived, Phase 2 swaps in iframe)"
  - "Outer try/catch around createAuthKey returns 502 on BPoint failure; inner try/catch around updateIntake logs but does NOT fail the response — a Redis hiccup must not turn a successful payment session into a client-facing failure"
  - "createAuthKey is called with exactly { sessionId, urgency, redirectionUrlBase } — no Stripe-era fields (uiMode, returnUrlBase, customerEmail) passed, matching CreateAuthKeyArgs signature"
  - "400 invalid-urgency guard retained unchanged (PRICING[urgency] check before any BPoint call)"
  - "No raw BPoint response body logged at the route layer — createAuthKey has its own `[bpoint]` logging; route layer only logs handler-level context `[checkout] AuthKey creation failed`"

patterns-established:
  - "Route-layer payment-provider error handling: try upstream call → catch → console.error with provider-named log prefix → NextResponse.json with sanitized message + 502"
  - "Persistence-failure isolation: wrap secondary-store writes in inner try/catch when the primary action (payment session creation) has already succeeded"

requirements-completed: [SESS-02, SESS-05]

# Metrics
duration: 1min
completed: 2026-04-23
---

# Phase 01 Plan 04: Checkout Route BPoint Swap Summary

**Rewrote `src/app/api/checkout/route.ts` to call BPoint `createAuthKey` and return `{ authKey }` (UUID) instead of Stripe `{ clientSecret }` — a breaking response-shape change that completes the Phase 1 server-side foundation. The AuthKey UUID is persisted to the intake record as `bpointTxnNumber`; BPoint failures return HTTP 502; Redis failures are isolated so they cannot turn a successful payment session into a client-facing error.**

## Performance

- **Duration:** ~1 min
- **Started:** 2026-04-23T17:38:29Z
- **Completed:** 2026-04-23T17:39:22Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- `src/app/api/checkout/route.ts` swapped end-to-end: Stripe imports removed, BPoint imports in place, response shape `{ authKey }` wired
- `npx tsc --noEmit` exits 0 across the entire repo — DATA-01 / SESS-02 gate holds
- `grep -rn "stripeSessionId" src/` returns empty (Plan 03 invariant preserved)
- 400 invalid-urgency guard preserved — no provider churn on this failure path
- 502 fail-closed path wired for BPoint upstream errors with sanitized client-facing error message
- Inner try/catch around `updateIntake` isolates Redis persistence failures — a Redis hiccup post-BPoint-success now logs but does NOT convert a live payment session into a 502
- `createAuthKey` called with exactly the three-field `CreateAuthKeyArgs` payload — no Stripe-era fields leaked through

## Task Commits

1. **Task 1: Rewrite checkout/route.ts to call createAuthKey and return { authKey }** — `193dde3` (feat)

**Plan metadata:** pending final commit (SUMMARY + STATE + ROADMAP)

## Files Created/Modified

- `src/app/api/checkout/route.ts` (40 lines) — full rewrite. New imports: `PRICING` from `@/lib/pricing`, `createAuthKey` from `@/lib/bpoint`, `updateIntake` from `@/lib/intake`. Response is `NextResponse.json({ authKey })` on success, `NextResponse.json({ error: "Payment session could not be created" }, { status: 502 })` on BPoint failure, and the unchanged 400 `{ error: "Invalid urgency" }` guard.

## Route Shape (Post-Plan)

- **Success (200):** `{ authKey: "<uuid>" }` — the BPoint AuthKey UUID, safe to embed in the iframe URL `https://bpoint.../webapi/Payment?AuthKey=<uuid>` (Phase 2 wires this)
- **Invalid urgency (400):** `{ error: "Invalid urgency" }` — unchanged
- **BPoint failure (502):** `{ error: "Payment session could not be created" }` — new. Logs `[checkout] AuthKey creation failed` server-side; `createAuthKey` has already logged the raw BPoint error under its own `[bpoint]` prefix
- **Redis persistence failure (still 200):** response succeeds, server logs `[checkout] failed to persist bpointTxnNumber to intake` — Redis is not the source of truth for payment state; the BPoint AuthKey is already live at this point

## Roadmap Success Criteria — All 5 Achievable

| SC  | Criterion                                                            | Where enforced                                                      | Status |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------- | ------ |
| #1  | `curl POST /api/checkout` returns `{ authKey: <uuid> }`              | `route.ts` line `return NextResponse.json({ authKey })`             | PASS   |
| #2  | AuthKey created with integer cents (132000 / 72600)                  | `createAuthKey` reads `PRICING[urgency].amount` directly            | PASS   |
| #3  | `npx tsc --noEmit` exits 0                                           | Run post-commit — zero errors                                       | PASS   |
| #4  | `IsTestTxn` is false only when `BPOINT_ENV === "prod"` (per-call)    | `getBpointConfig()` inside `createAuthKey` (Plan 02)                | PASS   |
| #5  | AuthKey expires after 30 minutes                                     | `ExpiryInMinutes: 30` in `createAuthKey` request body (Plan 02)     | PASS   |

## Decisions Made

- **No clientSecret compat alias:** CONTEXT.md explicitly forbids a transitional alias. The response shape is `{ authKey }` only. The existing PaymentCard UI will fail to boot on next deploy — this is expected and Phase 2 replaces it immediately with a BPoint iframe.
- **Nested try/catch semantics:** The outer try/catch wraps only `createAuthKey`. `updateIntake` gets its own inner try/catch so Redis flakiness cannot convert a successful BPoint payment session creation into a client-facing 502. The BPoint AuthKey is the source of truth — persistence is a best-effort breadcrumb.
- **502 (not 500) for BPoint failures:** 502 correctly communicates "upstream payment provider is unreachable or rejected the request" vs. 500's "this service has a bug". Better for monitoring dashboards and for the chat-widget retry UX.
- **Sanitized client-facing error:** `{ error: "Payment session could not be created" }` deliberately omits BPoint-specific details. Operators get the full context via the server-side `[checkout]` + `[bpoint]` log pair.
- **`redirectionUrlBase: process.env.NEXT_PUBLIC_URL ?? ""`:** Same env-var contract the old Stripe `returnUrlBase` used. Unbound / missing URL produces an empty string which BPoint will reject — surfaced as a 502 + server log rather than an unhandled throw.

## Deviations from Plan

None — plan executed exactly as written. The `<action>` code block landed verbatim.

## Issues Encountered

None in the primary deliverable. Pre-existing `npm run build` turbopack.root worktree issue (logged in `deferred-items.md` during Plan 01-01) still affects production build inside worktrees only — it is environmental, unrelated to route-layer code, and `npx tsc --noEmit` (the authoritative type gate) is clean. Outside the scope of this plan per SCOPE BOUNDARY.

## User Setup Required

To exercise the live contract (not required for this plan's sign-off):

- `BPOINT_API_USERNAME`, `BPOINT_API_PASSWORD`, `BPOINT_MERCHANT_NUMBER` must be set (still blocked — see STATE.md)
- Without those env vars, `curl -X POST http://localhost:3000/api/checkout -d '{"sessionId":"x","urgency":"urgent"}'` returns 502 with `{"error":"Payment session could not be created"}` and server log `[bpoint] BPOINT_API_USERNAME is not configured` — which proves the route is correctly wired even without credentials

## Next Phase Readiness

- Phase 1 foundation complete — all 4 plans landed cleanly (`01-01` pricing extraction, `01-02` BPoint AuthKey client, `01-03` field rename, `01-04` route swap)
- The chat widget's existing `PaymentCard` will break on next deploy — expected per CONTEXT.md; Phase 2 immediately replaces it with a BPoint iframe consuming the `{ authKey }` response
- Phase 3 (webhook) can begin in parallel once UAT credentials land — it consumes the same per-call `getBpointConfig` env-gating pattern established in Plan 02

---
*Phase: 01-foundation*
*Completed: 2026-04-23*

## Self-Check: PASSED

Created files:
- FOUND: `.planning/phases/01-foundation/01-04-SUMMARY.md`

Task commits:
- FOUND: `193dde3` (Task 1: feat(01-04): swap checkout route to BPoint createAuthKey)

Invariants:
- FOUND: `return NextResponse.json({ authKey })` in route.ts (exactly 1 match)
- FOUND: `bpointTxnNumber: authKey` in route.ts (exactly 1 match)
- FOUND: `"Payment session could not be created"` in route.ts
- FOUND: `status: 502` and `status: 400` guards in route.ts
- CONFIRMED: `grep -c "createCheckoutSession|clientSecret|client_secret|@/lib/stripe" src/app/api/checkout/route.ts` returns 0
- CONFIRMED: `grep -rn "stripeSessionId" src/` returns empty (Plan 03 gate holds)
- CONFIRMED: `npx tsc --noEmit` exits 0

Known out-of-scope:
- `npm run build` fails inside the worktree due to pre-existing turbopack.root issue (logged in `deferred-items.md` during Plan 01-01). Not caused by this plan; `npx tsc --noEmit` is the authoritative type gate and is clean.
