# Phase 3: Webhook & Cleanup - Context

**Gathered:** 2026-04-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Two deliverables, one phase:

1. **BPoint server-to-server webhook** at `POST /api/webhooks/bpoint` — a safety-net handler that fires the same fan-out as the confirm route when the browser redirect never lands (user closed the tab, flaky connection). Uses the same `retrieveTransaction` authoritative verification and the same `bpoint-txn:{TxnNumber}` SETNX dedup as Phase 2. Shares `handleConfirmedPayment` with the confirm route — no duplicated logic.
2. **Full Stripe removal** — delete `src/lib/stripe.ts`, `src/app/api/webhooks/stripe/route.ts`, port `src/app/api/checkout/resume/route.ts` to BPoint, scrub `STRIPE_*` env vars from code + docs + `.env.example`, rename stray `stripe-session:` Redis prefix in `src/scripts/revoke-upload-token.ts` to `bpoint-txn:`, uninstall the three npm packages (`stripe`, `@stripe/stripe-js`, `@stripe/react-stripe-js`).

Covers requirements WEBH-01, WEBH-02, WEBH-03, WEBH-04, CLEAN-01, CLEAN-02, CLEAN-03.

Out of scope (other phases):
- UAT E2E test execution — Phase 4 (TEST-01..03)
- Zapier/Smokeball reconciliation verification — Phase 4 (TEST-02)
- Production BPoint HPP product activation — external blocker, unrelated to this phase
- Search Transactions API fallback, refund endpoint, BPoint token storage — deferred to v2

</domain>

<decisions>
## Implementation Decisions

### Webhook authentication
- **Trust-via-retrieveTransaction only.** No shared secret, no IP allowlist, no signature check on the inbound POST. The authoritative check is the server-side call to BPoint's Retrieve Transaction API — a forged or replayed POST can't lie about whether the transaction is `Approved` because we re-verify against BPoint on every callback.
- Rationale: BPoint v5 callbacks are unsigned (per PITFALLS.md); any client-visible secret mechanism adds operational cost without raising the security floor above what `retrieveTransaction` already provides.
- Matches the confirm route's existing model — symmetry reduces surprise.

### Callback input contract
- **`ResultKey` from the request URL's query string** (same as the browser redirect). Parse via `new URL(req.url).searchParams.get("ResultKey")`; defensively also check `"resultkey"` casing (mirrors the confirm route's defense).
- **Do not parse the request body.** Per PITFALLS.md the v5 callback body schema is unknown; relying on the URL contract (which BPoint documents) avoids coupling to an unverified shape. If a future UAT payload reveals useful fields, add body parsing in a follow-up phase.
- Early-exit redirect pattern borrowed from confirm route: if `ResultKey` missing or malformed, log and return 200 (webhook MUST return 200 — WEBH-04).

### Shared fan-out + dedup
- **`handleConfirmedPayment` is already the shared helper** (built in Phase 2). Webhook imports and calls it, identical args: `{ sessionId, bpointTxnNumber, amountCents }` extracted from `retrieveTransaction.TxnResp`.
- **Dedup key: `bpoint-txn:{TxnNumber}`** via Redis SETNX + 7d TTL — identical namespace and TTL as the confirm route. Whichever path's SETNX returns `"OK"` runs the fan-out; the other sees the key exists and no-ops. No new keys, no new invariants.
- **Dual verification before fan-out**: `APIResponse.ResponseCode === 0` AND `TxnResp.Approved === true` (CONF-03 rule from Phase 2, re-applied verbatim). Webhook treats failed verification as a silent no-op + info log; it does NOT redirect to a failure page because there's no user on the other end.
- **Webhook always returns 200** (WEBH-04) regardless of fan-out outcome — prevents BPoint retry storms.

### Webhook URL handoff
- **Route path: `/api/webhooks/bpoint`** — matches ROADMAP SC#1 and WEBH-01 verbatim; mirrors `/api/webhooks/stripe/` layout.
- **URL is passed per-AuthKey at session-creation time**, not registered in the BPoint merchant portal. `src/lib/bpoint.ts#createAuthKey` gets a second URL field (likely `ServerNotificationUrl` / `NotificationUrl` — **researcher to confirm exact field name against BPoint v5 docs**) pointing to `${NEXT_PUBLIC_URL}/api/webhooks/bpoint`. Self-contained: no portal drift, per-env automatic.
- **Env derivation: reuse `NEXT_PUBLIC_URL` + `BPOINT_ENV`** — no new env vars. The webhook URL is the same origin as the confirm route's `RedirectionUrl`; BPoint UAT vs prod selection stays governed by `BPOINT_ENV` per Phase 1.
- **Fallback if BPoint v5 does NOT support a per-AuthKey notification URL**: researcher must flag this explicitly; fall back to one-time merchant-portal registration with UAT + prod URLs documented in INTEGRATIONS.md. This is the researcher's single blocking question for Phase 3.

### checkout/resume route
- **Port to BPoint, don't delete.** `src/app/api/checkout/resume/route.ts` currently reuses an existing Stripe session if the client re-opens mid-payment. New behavior:
  1. Look up intake by `sessionId`, read `bpointTxnNumber`.
  2. If set and AuthKey not yet expired (within Phase 1's 30-min TTL) — re-render the iframe with the existing AuthKey.
  3. If expired or missing — create a fresh AuthKey, overwrite `bpointTxnNumber` via `updateIntake` (same pattern as Phase 2's "Start again" expiry flow).
- Preserves the half-finished-payment recovery UX using BPoint primitives. Does NOT expand scope — it's a like-for-like port of existing behavior.

### Stripe-session Redis prefix in revoke-upload-token
- **Rename `stripe-session:` → `bpoint-txn:`** in `src/scripts/revoke-upload-token.ts`. Aligns with Phase 2's dedup namespace.
- **No migration script** for pre-existing `stripe-session:*` keys. Pre-production cutover; no live Stripe data to preserve; any orphaned keys expire at their 7-day TTL.

### Env var scrubbing
- **Remove `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`** from `.env.example`, any code references (there should be none after code deletion), and `.planning/codebase/INTEGRATIONS.md`.
- **Do NOT touch `.env.local`** — gitignored developer-local file, owner's responsibility.
- Production Vercel env scrub is an ops task, not a code change — note in the Phase 3 completion summary so Aquarius removes them before cutover.

### Cleanup sequencing
- **Webhook-first, cleanup-second.** Plan order:
  1. Build `POST /api/webhooks/bpoint` + `retrieveTransaction`-based flow (webhook becomes the safety net).
  2. Port `checkout/resume` route to BPoint (removes the last `getStripe()` caller).
  3. Delete `src/lib/stripe.ts` and `src/app/api/webhooks/stripe/route.ts`.
  4. Rename Redis prefix in `revoke-upload-token.ts`.
  5. Scrub env vars (`.env.example`, docs).
  6. `npm uninstall stripe @stripe/stripe-js @stripe/react-stripe-js` + verify `npm run build` + `npm run lint` clean.
- Rationale: keep the Stripe webhook (or its Phase 1 no-op form) as a backstop until the BPoint webhook is live, then remove in one confident pass.

### Observability
- **Structured `console.error` logging, no new alerting surface.** Keep the `[bpoint-webhook]` and `[payments]` bracket-prefix pattern from Phase 2. Vercel log aggregation is the single observability surface for v1.
- **Failure log fields**: `bpointTxnNumber`, `sessionId`, `error.message`, `error.stack`, `timestamp`, and a `phase` tag identifying which fan-out step failed (`"session-update"` / `"upload-token"` / `"receipt-email"` / `"transcript-email"`). Enough for support to reproduce or manually resume.
- **No retry mechanism** for fan-out failures — support manually re-runs the failed step using the logged `bpointTxnNumber` + `sessionId`. Mirrors the stripe-webhook precedent; avoids retry-queue complexity for a rare event.
- **Race logging**: both webhook-wins (confirm never arrived) and webhook-loses (confirm already ran) are `console.info` — neither is an alert condition. Happy-path symmetry with the confirm route.

### Claude's Discretion
- Exact naming of the BPoint notification URL field — researcher confirms (candidates: `ServerNotificationUrl`, `NotificationUrl`, `CallbackUrl`).
- Whether the webhook route uses `POST` only or also accepts `GET` (BPoint v5 behavior unclear; researcher confirms).
- Exact structure of the `phase` tag in failure logs (free-form string acceptable).
- Whether the webhook handler lives as a single `POST` export or splits into a small helper + handler — follow Phase 2's shape (`[bpoint-confirm]` route handler did both).
- Zod schema for the `retrieveTransaction` response — reuse the one built in Phase 2 (`BPointTxnResp` type), no new schema needed.
- Whether to capture a raw body snapshot on the first prod deploy for future reference (log `req.text()` at info level in first N days) — nice-to-have; Claude can add if cheap.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap + requirements
- `.planning/ROADMAP.md` §Phase 3 — goal, success criteria 1–4 (webhook calls retrieve + fan-out without duplication, shared helper used by both paths, Stripe packages absent, Stripe source files deleted)
- `.planning/REQUIREMENTS.md` — WEBH-01..04 and CLEAN-01..03 line items
- `.planning/PROJECT.md` — Zapier transcript contract non-negotiables, AUD + 30min TTL, dedup requirement

### Prior phase context (locked decisions carried forward)
- `.planning/phases/01-foundation/01-CONTEXT.md` — BPoint client + AuthKey shape; pricing module; `IsTestTxn` env gating per-call; `BPOINT_ENV` semantics
- `.planning/phases/02-confirmation-ui/02-CONTEXT.md` — shared fan-out helper `src/lib/payments/handleConfirmedPayment.ts`; `bpoint-txn:{TxnNumber}` SETNX + 7d TTL dedup; dual verification rule (`ResponseCode === 0` numeric AND `Approved === true`); confirm-route-is-primary / webhook-is-safety-net boundary
- `.planning/phases/02-confirmation-ui/02-VERIFICATION.md` — Phase 2 external blocker (BPoint HPP product activation) + code fixes discovered during verification (URL path, `ProcessTxnData` wrapper, prod-only host, `APIResponse`-based response parser)

### Technical research
- `.planning/research/ARCHITECTURE.md` — target architecture; webhook helper pattern, Redis dedup keys, fan-out boundaries
- `.planning/research/FEATURES.md` — BPoint v5 feature landscape, Stripe→BPoint replacement map, per-AuthKey URL field semantics
- `.planning/research/PITFALLS.md` — **critical for Phase 3**: unsigned callback (drives trust-via-retrieve decision), v5 webhook body schema unknown until captured (drives URL-only input contract), deduplication invariants
- `.planning/research/STACK.md` — Basic Auth format, iframe URL pattern, BPoint environment host map
- `.planning/research/SUMMARY.md` — research synthesis

### Codebase maps
- `.planning/codebase/CONVENTIONS.md` — naming, error-tag bracket prefix (`[bpoint-webhook]`, `[payments]`), lazy-singleton clients, named exports only
- `.planning/codebase/STRUCTURE.md` — where `src/app/api/webhooks/bpoint/route.ts` belongs
- `.planning/codebase/INTEGRATIONS.md` — env var names, Redis session shape, Zapier transcript monitoring contract (must not change); will need scrubbing of `STRIPE_*` entries as part of CLEAN-03
- `.planning/codebase/ARCHITECTURE.md` — how fan-out integrates with intake + Resend + Zapier
- `.planning/codebase/TESTING.md` — test conventions (vitest, jsdom for DOM, node for lib); Phase 3 tests will mirror Phase 2's confirm-route tests

### Existing code to read before modifying
- `src/app/api/checkout/confirm/route.ts` — Phase 2's confirm route; the webhook mirrors its structure (query-param extraction → retrieveTransaction → dual verification → SETNX → handleConfirmedPayment)
- `src/lib/payments/handleConfirmedPayment.ts` — shared fan-out helper; webhook imports verbatim
- `src/lib/bpoint.ts` — `createAuthKey` needs a second URL field added for notification URL; `retrieveTransaction` reused as-is
- `src/app/api/webhooks/stripe/route.ts` — reference for webhook-returns-200 pattern; deleted at the end of this phase
- `src/app/api/checkout/resume/route.ts` — current Stripe session reuse logic; port to BPoint AuthKey reuse + refresh
- `src/scripts/revoke-upload-token.ts` — `stripe-session:` prefix rename target
- `src/lib/stripe.ts` — deleted at the end of this phase
- `.env.example` — scrub `STRIPE_*` entries
- `package.json` — remove `stripe`, `@stripe/stripe-js`, `@stripe/react-stripe-js`

### External (for researcher reference only)
- BPoint Developer Reference v5 — https://www.bpoint.com.au/developers/v5/api (confirm per-AuthKey notification URL field name)
- BPoint Transaction Flow v5 — https://www.bpoint.com.au/developers/v5/api/txn/flow (confirm webhook dispatch timing + retry behavior)
- BPoint UAT — `bpoint.uat.linkly.com.au`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/payments/handleConfirmedPayment.ts` — shared fan-out helper, built in Phase 2 for exactly this reuse. Webhook calls it with `{ sessionId, bpointTxnNumber, amountCents }` extracted from `retrieveTransaction.TxnResp`.
- `src/app/api/checkout/confirm/route.ts` — the structural template for the webhook. Copy the query-param extraction, `retrieveTransaction` call, dual verification, and SETNX dedup; swap the browser redirects for `NextResponse.json({ received: true })` (always 200).
- `src/lib/bpoint.ts#retrieveTransaction` — reused as-is. Phase 2 already built the type contract (`BPointTxnResp`) and error handling.
- `src/lib/bpoint.ts#createAuthKey` — extended with one additional URL field for the per-AuthKey notification URL (researcher confirms field name).
- `src/app/api/webhooks/stripe/route.ts:85–130` — reference implementation for the "webhook returns 200 regardless" pattern and structured logging shape. Deleted at the end of this phase.
- `src/lib/intake.ts#updateIntake` / `src/lib/kv.ts` — already used by `handleConfirmedPayment` and by Phase 1's AuthKey refresh; resume route port reuses the same primitives.

### Established Patterns
- **Webhook returns 200 regardless of fan-out outcome** — precedent from `src/app/api/webhooks/stripe/route.ts`. Matches WEBH-04 verbatim.
- **Bracket-prefixed structured logging**: `[bpoint-webhook]` for the route, `[payments]` for the shared helper (matches Phase 2 conventions).
- **SETNX + TTL dedup** via `redis.set(key, "pending", { nx: true, ex: TTL })`, then upgrade to token hash after successful fan-out (mirrors the confirm route's exact pattern).
- **No default exports**, named exports only. `PascalCase` types, `camelCase` functions.
- **Path aliases** (`@/...`), no relative imports.
- **Lazy-singleton BPoint config** (`getBpointConfig()`), per-call `IsTestTxn` evaluation — no need to re-read at webhook time because `retrieveTransaction` already uses it.

### Integration Points
- **Webhook entry**: `POST /api/webhooks/bpoint` — reads `ResultKey` from query string, calls `retrieveTransaction`, gates on dual-verification, SETNX dedup on `bpoint-txn:{TxnNumber}`, calls `handleConfirmedPayment` on first-write, returns 200.
- **AuthKey creation**: `src/lib/bpoint.ts#createAuthKey` gains one additional field for the notification URL passed to BPoint.
- **Resume route port**: `src/app/api/checkout/resume/route.ts` stops calling `getStripe()`; either reuses stored `bpointTxnNumber` (if within AuthKey TTL) or issues a fresh `createAuthKey` + `updateIntake` overwrite.
- **Revoke script**: `src/scripts/revoke-upload-token.ts` reads the upgraded `bpoint-txn:{sessionId}` key instead of `stripe-session:{sessionId}`.
- **Tests**: mirror Phase 2's `tests/payment-card.test.tsx` + confirm-route tests under `tests/` using vitest; node env for webhook-route unit tests, jsdom reserved for DOM tests only.

</code_context>

<specifics>
## Specific Ideas

- The webhook handler should feel like a carbon copy of the confirm route minus the redirects — deliberate symmetry makes the "shared fan-out" requirement (WEBH-03) visible in the code, not just in docs.
- Structured log JSON for failure: `{ tag: "[bpoint-webhook]", phase: "<step>", bpointTxnNumber, sessionId, err: { message, stack }, timestamp }` — shape pinned so support can build a log query once and reuse it.
- Keep the Stripe webhook file alive for one last moment: delete it in the same commit that removes `src/lib/stripe.ts`, so no orphaned imports ever exist in the tree.
- The notification URL field's exact name is the researcher's single blocking question. Everything else in Phase 3 can be planned in parallel.

</specifics>

<deferred>
## Deferred Ideas

- Raw-body snapshot capture on first prod deploy (log `req.text()` for N days to harvest a real v5 callback schema) — nice-to-have; Claude may add opportunistically during planning.
- Alert email to firm ops on fan-out failure — skipped for v1; add only if support reports signal gaps.
- Redis failure-list for post-hoc inspection (`bpoint-webhook:failures`) — not needed with Vercel log retention; revisit if retention shrinks.
- Inline retry with backoff for fan-out steps — rejected for v1; complexity outweighs rarity of Resend/Redis flaps.
- Warn when webhook consistently wins the SETNX race (signals confirm-redirect regression) — future observability, track only if data shows it's useful.
- One-time Redis SCAN migration of `stripe-session:*` → `bpoint-txn:*` — not needed (pre-production cutover, no live data).
- Separate webhook URL per env via `BPOINT_WEBHOOK_URL` override — not needed while `NEXT_PUBLIC_URL` derivation suffices.
- Search Transactions API fallback for session-limbo recovery (RESL-01), email-based payment resume flow (RESL-02), refund endpoint (REFD-01..02), BPoint token storage (TOKN-01) — all v2.

</deferred>

---

*Phase: 03-webhook-cleanup*
*Context gathered: 2026-04-24*
