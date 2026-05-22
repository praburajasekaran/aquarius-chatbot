# Phase 1: Foundation - Context

**Gathered:** 2026-04-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Server-side BPoint foundation. Build `src/lib/bpoint.ts` API client (Basic Auth with `username|merchantnumber:password`), make `POST /api/checkout` return a BPoint AuthKey UUID instead of a Stripe `clientSecret`, rename `stripeSessionId` → `bpointTxnNumber` across types/Redis/intake/email modules, gate `IsTestTxn` by environment, preserve existing two-tier pricing with exact `lineItem` strings.

Covers requirements SESS-01, SESS-02, SESS-03, SESS-04, SESS-05, DATA-01, DATA-02, DATA-03.

Out of scope for Phase 1: PaymentCard UI rewrite (Phase 2), confirm route (Phase 2), webhook handler (Phase 3), Stripe package/code removal (Phase 3), UAT E2E testing (Phase 4).

</domain>

<decisions>
## Implementation Decisions

### Type rename strategy
- **Hard rename, single pass.** `stripeSessionId` → `bpointTxnNumber` updated in every reference during Phase 1. No additive/coexistence period, no type alias shim.
- Applies to: `src/types/index.ts` (SessionData), `src/lib/kv.ts` (createSession default), `src/lib/intake.ts`, `src/lib/resend.ts`, `src/app/api/checkout/route.ts`, `src/app/api/checkout/resume/route.ts`, `src/scripts/revoke-upload-token.ts`, and the existing Stripe webhook at `src/app/api/webhooks/stripe/route.ts`.
- Stripe webhook handling during Phase 1 soak: planner decides between (a) updating the webhook's field reads to use `bpointTxnNumber` as a neutral identifier, or (b) no-op'ing the webhook body until Phase 3 deletes it. Either is acceptable; the file still exists on disk until Phase 3.
- Roadmap success criterion #3 is the acceptance gate — zero TypeScript errors across the codebase.

### Pricing module location
- **Extract to `src/lib/pricing.ts`** — provider-neutral module. Exports `PRICING` object and `CheckoutUrgency` type.
- `src/lib/bpoint.ts` imports pricing from `src/lib/pricing.ts`.
- `src/lib/stripe.ts` (still present during Phase 1–3 soak) imports pricing from `src/lib/pricing.ts` — no duplication.
- Exact `lineItem` strings preserved verbatim: "Initial Deposit for Urgent Court Matter", "Legal Strategy Session" (Smokeball reconciliation is non-negotiable).
- Amounts preserved as integer cents: Urgent 132000, Non-Urgent 72600. DATA-03 compliant.

### IsTestTxn env gating
- **`IsTestTxn = process.env.BPOINT_ENV !== "prod"`**. Fail-safe default: unset or typo → test mode (no real charges).
- Production requires explicit opt-in via `BPOINT_ENV=prod`. Aligns with existing INTEGRATIONS.md note.
- Do NOT couple to `NODE_ENV` or `VERCEL_ENV` — preview deploys should stay in test mode by default.
- Must be evaluated at AuthKey-creation time (per-request), not at module load, to avoid caching stale bundle-time values on serverless platforms.

### Checkout route response shape
- **Breaking change: `POST /api/checkout` returns `{ authKey: string }`** (UUID string from BPoint AuthKey creation).
- No compat shim, no `clientSecret` alias. The existing PaymentCard will fail to boot after Phase 1 — that is expected and short-lived. Phase 2 immediately replaces PaymentCard with a BPoint iframe and wires it to the new field.
- Roadmap success criterion #1 is the acceptance gate: `curl POST /api/checkout` returns an authKey UUID, not a Stripe clientSecret.

### AuthKey expiry (SESS-05)
- AuthKey session TTL is 30 minutes. Configured at AuthKey-creation time against BPoint (matches existing Stripe `expires_at: Math.floor(Date.now() / 1000) + 30 * 60` pattern).
- Redis session TTL (separate concern) stays at 1 hour as today — no change.

### BPoint API client (SESS-01)
- New file: `src/lib/bpoint.ts`. Named exports, lazy singleton if credentials are read at runtime (follow the `getStripe()` pattern from `src/lib/stripe.ts`).
- Basic Auth header format: `Authorization: Basic base64(username|merchantnumber:password)` — the pipe character is part of the BPoint API spec, not a typo.
- Required env vars (already documented in INTEGRATIONS.md): `BPOINT_API_USERNAME`, `BPOINT_API_PASSWORD`, `BPOINT_MERCHANT_NUMBER`. Optional: `BPOINT_BILLER_CODE`, `BPOINT_ENV`.
- Base URL derived from `BPOINT_ENV`: `prod` → production BPoint endpoint, else UAT (`bpoint.uat.linkly.com.au`).
- Throw with descriptive messages if required env vars are missing (match the `STRIPE_SECRET_KEY is not configured` pattern in `src/lib/stripe.ts`).

### AuthKey session creation (SESS-02)
- POST to BPoint AuthKey endpoint with: `Amount` (integer cents), `Crn1 = sessionId`, `RedirectionUrl = ${NEXT_PUBLIC_URL}/api/checkout/confirm` (route itself is built in Phase 2, but the URL is baked into the AuthKey request now).
- `CurrencyCode: "AUD"`.
- `IsTestTxn` evaluated per decision above.
- On success, persist the returned AuthKey UUID to the intake record's `bpointTxnNumber` field (mirrors the existing `updateIntake(sessionId, { stripeSessionId: checkoutSession.id })` pattern in `src/app/api/checkout/route.ts`).

### Zapier transcript field (DATA-02)
- The firm's Zap monitors the transcript email for payment identifier fields. Field structure must be preserved — rename the field label/value source from Stripe session id to `bpointTxnNumber`, but do not add, remove, or reorder fields in the transcript email template or `sendTranscriptEmail` payload.
- Planner must audit `src/lib/resend.ts` to confirm transcript email payload shape remains compatible.

### Claude's Discretion
- Exact function signatures and internal shape of `src/lib/bpoint.ts` (one module with functions vs a class — follow codebase conventions).
- Whether to extract a `createAuthKey()` helper or inline AuthKey creation in `/api/checkout/route.ts`.
- Error-tag prefix for `bpoint.ts` logs (suggest `[bpoint]` matching `[checkout]`/`[stripe]` convention).
- Zod schema for the BPoint AuthKey response (add if it aids type safety; skip if JSON.parse + TypeScript cast is consistent with existing external API calls).
- Whether to update the Stripe webhook in-place or no-op it for the Phase 1–3 soak (either is acceptable; full deletion happens in Phase 3).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project specs
- `docs/superpowers/specs/2026-04-22-urgent-sms-and-bpoint-payment-design.md` — original BPoint integration design spec referenced during project init

### Project planning
- `.planning/PROJECT.md` — vision, constraints (lineItem exact, AUD only, 30min TTL, Zapier field structure), Key Decisions table
- `.planning/REQUIREMENTS.md` — full requirement list; SESS-01..05 and DATA-01..03 are Phase 1's scope
- `.planning/ROADMAP.md` §Phase 1 — goal, success criteria 1–5 (AuthKey UUID return, integer cents amounts, TS-error-free, env-gated IsTestTxn, 30min TTL)

### Technical research
- `.planning/research/FEATURES.md` — BPoint v5 feature landscape, Stripe↔BPoint replacement map, anti-features (no 3DS, no surcharges, no raw card handling), MVP scope
- `.planning/research/ARCHITECTURE.md` — target architecture patterns for BPoint integration
- `.planning/research/PITFALLS.md` — known gotchas (unsigned callback, deduplication, UAT credential handling, v5 webhook schema unknown until captured)
- `.planning/research/STACK.md` — stack constraints
- `.planning/research/SUMMARY.md` — research synthesis

### Codebase maps
- `.planning/codebase/CONVENTIONS.md` — naming (kebab-case files, PascalCase types, camelCase functions), error-tag bracket prefix, lazy-singleton clients, getX() getter pattern, no default exports
- `.planning/codebase/STRUCTURE.md` — where `src/lib/bpoint.ts` and `src/lib/pricing.ts` belong; API route layout
- `.planning/codebase/INTEGRATIONS.md` — confirmed env var names (`BPOINT_API_USERNAME`, `BPOINT_API_PASSWORD`, `BPOINT_MERCHANT_NUMBER`, `BPOINT_BILLER_CODE`, `BPOINT_ENV`), existing Redis session shape, Zapier transcript monitoring contract
- `.planning/codebase/ARCHITECTURE.md` — how payment session creation integrates with intake + Redis today

### External (for researcher reference only)
- BPoint Developer Reference v5 — https://www.bpoint.com.au/developers/v5/api
- BPoint Transaction Flow v5 — https://www.bpoint.com.au/developers/v5/api/txn/flow
- BPoint UAT — `bpoint.uat.linkly.com.au`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/stripe.ts:18-31` — `PRICING` constant with exact `lineItem`/`tier`/`amount`/`displayPrice` fields. Move as-is to `src/lib/pricing.ts`.
- `src/lib/stripe.ts:5-13` — `getStripe()` lazy-singleton + env-var guard pattern. Mirror this for `getBpointConfig()` or similar in `src/lib/bpoint.ts`.
- `src/lib/kv.ts:15-36` — `createSession()` takes `Partial<SessionData>`; rename `stripeSessionId: null` default to `bpointTxnNumber: null`.
- `src/lib/intake.ts` — `updateIntake(sessionId, partial)` already accepts partial session data; call site in `/api/checkout/route.ts:22` just needs the field name swap.
- `src/app/api/checkout/route.ts:15-27` — current Stripe call shape; replace body with BPoint AuthKey creation, same try/catch around `updateIntake`.

### Established Patterns
- **Lazy-singleton clients with env guards** (stripe.ts, openrouter.ts) — throw `X is not configured` on missing env. Mirror in `bpoint.ts`.
- **Bracket-prefixed error logging** (`console.error("[checkout] …", err)`) — use `[bpoint]` for new module, keep `[checkout]` for route-level errors.
- **Named exports only**, no default exports. `PascalCase` types, `camelCase` functions, `UPPER_SNAKE_CASE` constants.
- **Path aliases**: all imports use `@/…` not relative paths.
- **API error shape**: `NextResponse.json({ error: "message" }, { status })`.
- **Environment-gated behavior** is not currently centralized — introducing `BPOINT_ENV` check inside `src/lib/bpoint.ts` is consistent (other modules read `process.env` directly too).

### Integration Points
- `src/app/api/checkout/route.ts` — the single call site that changes response shape.
- `src/types/index.ts:18` — `stripeSessionId: string | null` field is the type-level seed of the rename.
- `src/lib/kv.ts:28` — session default value must update in lockstep with the type.
- `src/lib/intake.ts` — intake record persistence; grep confirms it references `stripeSessionId`.
- `src/lib/resend.ts` — transcript email payload references `stripeSessionId`; DATA-02 requires preserving the field structure Zapier reads.
- `src/app/api/checkout/resume/route.ts` — also references `stripeSessionId`; included in rename scope.
- `src/scripts/revoke-upload-token.ts` — also references `stripeSessionId`; included in rename scope.
- `src/app/api/webhooks/stripe/route.ts` — references `stripeSessionId`; planner chooses update-in-place vs no-op until Phase 3 deletes it.

</code_context>

<specifics>
## Specific Ideas

- Mirror the existing Stripe module shape so the planner has a clear template: `getX()` factory, exported helper (`createCheckoutSession` equivalent → `createAuthKey`), shared `CreateAuthKeyArgs` interface.
- Keep the `lineItem` strings byte-identical — they are checked into PROJECT.md/REQUIREMENTS.md as legal-compliance values.
- The 30-minute expiry is already encoded in `src/lib/stripe.ts:63` as `Math.floor(Date.now() / 1000) + 30 * 60`; reuse the literal.

</specifics>

<deferred>
## Deferred Ideas

- BPoint JavaScript iframe integration + PaymentCard component rewrite → Phase 2 (UI-01..04, CONF-01..05)
- Retrieve Transaction Result API + confirm route → Phase 2
- Server-to-server webhook handler + `handleConfirmedPayment()` shared helper → Phase 3 (WEBH-01..04)
- Stripe npm package + source file removal → Phase 3 (CLEAN-01..03)
- UAT end-to-end test execution → Phase 4 (TEST-01..03)
- Zod schema for BPoint callback payload (blocked on capturing a real v5 UAT payload per STATE.md blocker) → Phase 3
- Search Transactions fallback, refund API, BPoint token storage → v2 (RESL-01..02, REFD-01..02, TOKN-01)

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-04-23*
