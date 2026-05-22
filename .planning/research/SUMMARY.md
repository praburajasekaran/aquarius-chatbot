# Project Research Summary

**Project:** BPoint Payment Integration (Stripe Replacement)
**Domain:** Payment gateway swap — existing Next.js 15 chat app for Australian law firm
**Researched:** 2026-04-23
**Confidence:** MEDIUM — BPoint v5 docs are a React SPA not fully indexed by search engines; core API behaviour is confirmed via official partial content, third-party integrations, and PHP driver source inspection, but some v5-specific endpoint paths require direct portal access to verify.

---

## Executive Summary

This is a brownfield payment processor swap — not a greenfield payment feature. Every downstream workflow (Resend receipts, Zapier/Smokeball CRM sync, Redis session management, upload token creation) already exists and works. The only thing changing is what sits between "client clicks Pay" and "session is marked paid." The existing architecture maps cleanly to BPoint: `clientSecret` becomes `authKey`, the Stripe iframe becomes a BPoint iframe, and the Stripe webhook becomes a BPoint ResultKey verify-on-redirect plus an optional server-to-server callback. No new npm packages are required — native `fetch`, existing `zod`, and existing `crypto` cover the entire integration.

The single most important difference from Stripe is how payment confirmation works. Stripe sends HMAC-signed webhook events that can be verified cryptographically. BPoint does not. Instead, BPoint redirects the browser to your `RedirectionUrl` with a `ResultKey` parameter, and your server must call BPoint's retrieve-transaction API using that key to get the authoritative payment status. The `ResponseCode=0` in the redirect URL is client-visible and trivially forgeable — it must never be treated as payment proof. Additionally, BPoint's optional server-to-server callback has no HMAC signature; authentication must be done via a shared secret in the callback URL. This changes the security model significantly from Stripe and is the highest-risk area of the migration.

Three open risks need resolution before or during implementation: (1) UAT credentials must be obtained from the firm before any development can begin — without them, nothing can be tested against BPoint; (2) BPoint v5 webhook payload schema is not publicly accessible (React SPA content), so the confirm-route implementation should be built to work without webhooks as the primary path; and (3) the Zapier/Smokeball field mapping is brittle — the `lineItem` description string and the "BPoint Transaction" label in the transcript email HTML must be treated as a typed contract, not free-form text, or invoice reconciliation silently breaks.

---

## Key Findings

### Recommended Stack

No new dependencies are needed. The BPoint integration is pure REST over native `fetch` (available in Next.js 15 Route Handlers as a Node 18+ built-in). Existing `zod` handles webhook payload validation; existing `crypto` handles any signature verification. The integration follows a new module `src/lib/bpoint.ts` (replacing `src/lib/stripe.ts`) that encapsulates `createBPointAuthKey()`, `retrieveBPointResult()`, `buildBasicAuth()`, and the `PRICING` constants.

**Core technologies:**
- **BPoint REST API v2/v5**: Payment session (AuthKey) creation, iframe rendering, transaction result retrieval — no npm SDK exists, raw REST is the only option
- **Next.js App Router Route Handlers**: Server-side AuthKey creation and result verification — must use Node.js runtime (not Edge Runtime, which lacks `Buffer`/`crypto`)
- **BPoint iframe embed (single-page mode)**: Hosted PCI-compliant card form — card data never touches your server; `ShowSubmitButton: false` lets you control the Pay button outside the iframe
- **Upstash Redis (existing)**: Deduplication gate (`bpoint-txn:{TxnNumber}` keys, 7-day TTL), session state (`bpointTxnNumber` field replacing `stripeSessionId`)
- **BPoint UAT environment** (`bpoint.uat.linkly.com.au`): Full production mirror — requires separate UAT credentials from the firm, not the same as production creds

**Critical version note:** Do not use Edge Runtime for any BPoint route handler. `Buffer` (used for Basic Auth encoding) is not available in Edge.

### Expected Features

BPoint covers the table stakes for Australian legal payment processing but differs from Stripe in ways that the implementation must explicitly handle.

**Must have for launch (P1):**
- AuthKey session creation endpoint — replaces `/api/checkout` Stripe session creation
- BPoint iframe in `PaymentCard` — replaces `EmbeddedCheckoutProvider`/`EmbeddedCheckout`
- Server-side ResultKey verification on redirect landing — non-negotiable for payment security
- Dual success check: `ResponseCode === "0"` AND `Approved === true` — checking only `ResponseCode` misses bank-declined cards
- Idempotency guard on the confirm route and webhook handler — Redis NX check on `bpointTxnNumber` before any fan-out
- Failure/decline message mapping — BPoint bank response codes must map to human-readable chat UI messages
- `stripeSessionId` → `bpointTxnNumber` field rename across `SessionData`, `IntakeRecord`, `resend.ts`
- UAT smoke test against BPoint sandbox before production cutover
- CSP header update — `frame-src` and `connect-src` must include `https://www.bpoint.com.au` and `https://bpoint.uat.linkly.com.au`

**Should have — add after core flow is validated (P2):**
- Search Transactions fallback — single call on session resume if redirect was never received (not a polling loop)
- `POST /api/webhooks/bpoint` as secondary confirmation path — handles browser disconnects after payment; deduplication via Redis makes it safe to run alongside the confirm route

**Defer to v2+:**
- BPoint token storage for repeat-client payments
- PowerBoard migration path (CBA's successor gateway — not imminent for existing BPoint customers)
- Programmatic refund API (currently handled manually via BPoint Merchant Back Office)

**Anti-features — do not build:**
- 3D Secure: BPoint does not support 3DS 1 or 3DS 2. Do not implement it.
- Treating BPoint callback as a signed webhook (no HMAC header exists)
- Variable surcharge pass-through (breaks fixed $1,320/$726 AUD pricing tiers)
- Polling loop for payment status (use single fallback call, not continuous polling)

### Architecture Approach

The existing architecture maps 1:1 to BPoint with minimal structural changes. The flow becomes: `PaymentCard` calls `POST /api/checkout` → server creates BPoint AuthKey → client renders BPoint iframe → client enters card details → BPoint redirects browser to `GET /api/checkout/confirm?ResultKey=uuid` → server verifies with BPoint API → session marked paid → existing fan-out fires unchanged (upload token, receipt email, transcript email/Zapier). A separate `POST /api/webhooks/bpoint` route handles the optional server-to-server callback as a secondary path, sharing the same `handleConfirmedPayment()` helper to prevent fan-out duplication.

**Major components and their changes:**

1. **`src/lib/bpoint.ts`** (NEW — replaces `stripe.ts`) — `createBPointAuthKey()`, `retrieveBPointResult()`, `buildBasicAuth()`, `PRICING` constants in cents
2. **`POST /api/checkout`** (MODIFY) — swap Stripe session creation for BPoint AuthKey; return `{ authKey }` instead of `{ clientSecret }`
3. **`GET /api/checkout/confirm`** (NEW) — primary confirmation path; receives `ResultKey` from redirect, calls BPoint retrieve API, deduplicates via Redis, triggers fan-out
4. **`POST /api/webhooks/bpoint`** (NEW — replaces `webhooks/stripe`) — secondary confirmation; URL-secret authentication (no HMAC); shares `handleConfirmedPayment()` with confirm route
5. **`payment-card.tsx`** (MODIFY) — replace `EmbeddedCheckoutProvider` with `<iframe src="https://www.bpoint.com.au/webapi/v2/txns/iframe/{authKey}" />`
6. **`src/types/index.ts`, `intake.ts`, `kv.ts`, `resend.ts`** (MODIFY) — rename `stripeSessionId` → `bpointTxnNumber` across all four files in a single coordinated change

**Key data mapping:** BPoint's `Crn1` field carries your `sessionId` through the transaction (equivalent to Stripe's `session.metadata.sessionId`). Client email and name are NOT returned by BPoint's transaction response — they must be fetched from `getIntake(txn.Crn1)` in the confirm route, exactly as the existing Stripe webhook flow already does.

**Build order:** `bpoint.ts` → type renames → `POST /api/checkout` → `GET /api/checkout/confirm` → `PaymentCard` → `resend.ts` label update → `POST /api/webhooks/bpoint` → `GET /api/checkout/resume` → remove `stripe.ts` and Stripe npm packages.

### Critical Pitfalls

1. **Trusting redirect URL as payment proof** — `ResponseCode=0` in the redirect query string is client-visible and forgeable. Always call BPoint's retrieve-transaction API server-side with the `ResultKey` and verify both `ResponseCode === "0"` AND `Approved === true` in the authenticated response before any downstream action. Missing this allows anyone to manufacture a confirmation URL and receive upload tokens and legal service without paying.

2. **Malformed Basic Auth header** — BPoint uses `username|merchantnumber:password` (pipe-separated), not the standard `username:password`. Every standard Basic Auth helper produces the wrong credential silently. The resulting HTTP 401 looks like a credentials issue, not a format issue. Build the header explicitly: `Buffer.from(`${username}|${merchantNumber}:${password}`).toString("base64")`.

3. **Amount in dollars instead of integer cents** — BPoint expects `Amount` as an integer in cents (`132000` for $1,320 AUD). Passing `1320` or `1320.00` charges $13.20. Define pricing constants with explicit `Cents` naming and add a runtime `Number.isInteger(amount)` guard at the API call site.

4. **No webhook deduplication** — BPoint can retry server-to-server callbacks on delivery failure. Without Redis NX deduplication on `TxnNumber`, each retry triggers a new receipt email, a new upload token, and a new Zapier/Smokeball event. Set the dedup key BEFORE fan-out (not after) to prevent race conditions on concurrent retries.

5. **`IsTestTxn` flag left on in production** — BPoint's test mode is a per-request flag, not a separate environment. `IsTestTxn: true` in production payloads causes transactions to appear successful in the app but collect no money. Gate it strictly on `process.env.NODE_ENV !== "production"` and add a CI grep check that fails on the literal string `IsTestTxn: true`.

6. **CSP blocks BPoint iframe** — Missing `frame-src https://www.bpoint.com.au` in Next.js CSP headers causes the iframe to render as a blank white box with no visible error in the UI. Check the browser console for CSP violations before any other integration testing.

7. **lineItem string drift breaks Smokeball reconciliation** — Zapier parses specific field values from the transcript email HTML. Any change to the `lineItem` description string, or renaming "Stripe Session" → "BPoint Transaction" in the wrong format, silently breaks invoice creation. Define line items as typed constants and run a full Zapier end-to-end test after any email template change.

---

## Implications for Roadmap

Based on combined research, the migration has clear dependency ordering. The BPoint API client and type renames must exist before any route changes; the confirm route is the highest-risk new component and must be built before the client iframe; the webhook is a secondary path that builds on the confirm route's shared logic.

### Phase 1: BPoint API Client and Session Endpoint

**Rationale:** Everything else depends on a working `bpoint.ts` module and a confirmed AuthKey flow. This can be tested with `curl` before touching the UI. Type renames happen here because TypeScript will catch all call sites immediately, preventing drift.

**Delivers:** Working server-side AuthKey creation, correct Basic Auth encoding, pricing constants in cents, type-safe `SessionData`/`IntakeRecord` with `bpointTxnNumber`, CSP header update

**Addresses:** AuthKey session creation (P1), `stripeSessionId` → `bpointTxnNumber` rename, amount-in-cents enforcement, auth header correctness, CSP frame-src

**Avoids:** Malformed auth header (Pitfall 2), amount encoding errors (Pitfall 3), field drift across types (Anti-Pattern 4), CSP blocking iframe (Pitfall 6)

**Research flag:** Standard pattern — well-documented REST integration. Verify exact AuthKey endpoint path against BPoint UAT on first call.

### Phase 2: Payment Confirmation Route

**Rationale:** The confirm route (`GET /api/checkout/confirm`) is the highest-security component and the primary new control flow. It must exist before the iframe can be wired up — the iframe's `RedirectionUrl` points here. Building it first lets it be tested independently with synthetic `ResultKey` values against BPoint UAT.

**Delivers:** Secure server-side payment verification, Redis deduplication gate, fan-out trigger (upload token + receipt email + transcript email), redirect to `/?payment=success`

**Addresses:** ResultKey verification (P1), dual ResponseCode+Approved check (P1), idempotency guard (P1), fan-out trigger

**Avoids:** Trusting redirect URL (Pitfall 1), single-field success check (Pitfall 5), deduplication gap (Pitfall 4)

**Research flag:** Needs UAT validation — verify exact BPoint transaction retrieve response schema (`TxnResp.Approved` field nesting) against a real UAT response. The PHP driver source (`omnipay-bpoint/Response.php`) is the best available reference but must be confirmed.

### Phase 3: PaymentCard Iframe

**Rationale:** Client-facing change. Safe to build once the server-side session endpoint and confirm route exist. The iframe points to both — it needs the authKey from checkout and redirects to confirm on completion.

**Delivers:** BPoint iframe replacing Stripe `EmbeddedCheckoutProvider`, AuthKey loading state, decline messaging in chat UI, AuthKey expiry UX

**Addresses:** BPoint JS payment form (P1), failure/decline message mapping (P1), AuthKey expiry handling

**Avoids:** Parent-window redirect breaking chat context (UX Pitfall 3), double-click AuthKey creation (UX Pitfall 4)

**Research flag:** Standard pattern — iframe embed is well-documented. Confirm iframe URL format (`/webapi/v2/txns/iframe/{authKey}`) against UAT on first load.

### Phase 4: Webhook Handler and Downstream Pipeline

**Rationale:** Secondary confirmation path. The fan-out logic is already in the confirm route — this phase extracts it into a shared `handleConfirmedPayment()` helper and wires it to the optional BPoint server-to-server callback. The Resend/Zapier label rename happens here because it is the last change to the downstream pipeline.

**Delivers:** `POST /api/webhooks/bpoint` with URL-secret authentication, shared `handleConfirmedPayment()` helper, `resend.ts` param rename, transcript email "BPoint Transaction" label update, Zapier field mapping verification

**Addresses:** Webhook/callback handler (P1), idempotency guard on webhook (P1), lineItem contract enforcement, Zapier smoke test

**Avoids:** HMAC webhook assumption (Anti-Pattern 2), lineItem drift (Pitfall 8), duplicate emails on webhook retry (Pitfall 4)

**Research flag:** BPoint webhook payload schema is behind the React SPA portal — capture raw POST body from a UAT test transaction and define the Zod schema from the actual payload. Callback URL configuration requires BPoint Merchant Back Office portal access.

### Phase 5: Production Hardening and Go-Live

**Rationale:** `IsTestTxn` gating, production credential swap, Search Transactions fallback, `resume` route update, and Stripe removal are all go-live concerns safest to address after the core flow is end-to-end tested in UAT.

**Delivers:** `IsTestTxn` gated on `NODE_ENV`, CI check for literal `IsTestTxn: true`, production BPoint credentials, Search Transactions fallback on session resume, `stripe.ts` removed, Stripe npm packages uninstalled

**Addresses:** Test mode in production (Pitfall 7), Search Transactions fallback (P2), `GET /api/checkout/resume` update, dependency cleanup

**Avoids:** TestMode left on (Pitfall 7 — zero revenue if missed), Stripe dependencies causing bundle bloat after cutover

**Research flag:** Standard — mechanical changes. Production credential provisioning depends on the firm completing BPoint merchant portal setup.

### Phase Ordering Rationale

- Foundation-first: `bpoint.ts` and type renames must precede all routes so TypeScript enforces field correctness across the codebase from the start
- Confirm route before iframe: the iframe's `RedirectionUrl` points to the confirm route — the target must exist before the source is wired
- Webhook after confirm: the webhook shares `handleConfirmedPayment()` with the confirm route — extracting that helper is easier once the confirm route is working and tested
- Hardening last: `IsTestTxn` gating and Stripe removal are destructive changes that should only happen after a full UAT end-to-end pass

### Research Flags

**Needs validation during implementation:**
- **Phase 2 (confirm route):** BPoint transaction retrieve response schema — specifically the `TxnResp.Approved` field nesting. Verify against a real UAT response before finalising the dual-check function.
- **Phase 4 (webhook handler):** BPoint v5 webhook payload schema is behind the developer portal React SPA. Capture the raw POST body from a UAT test transaction and derive the Zod schema from it.
- **Phase 4 (webhook config):** Callback URL configuration in BPoint Merchant Back Office requires direct portal access — needs the firm to provide access or complete the setup.

**Standard patterns (no additional research needed):**
- **Phase 1:** Basic Auth encoding, REST calls, Zod validation
- **Phase 3:** iframe URL format, CSP header update
- **Phase 5:** Environment variable gating, dependency removal

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | No npm SDK; REST endpoints confirmed via multiple sources including PHP driver inspection and partial official docs. v5-specific endpoint paths need UAT validation on first call. |
| Features | MEDIUM | Core capabilities confirmed. 3DS absence confirmed via Spreedly guide. Webhook payload schema not publicly accessible — build to be resilient to schema surprises. |
| Architecture | MEDIUM-HIGH | Component map is clear and follows existing patterns closely. The single-page iframe mode and confirm-route redirect pattern are well-understood. Data field mappings verified against PHP driver source. |
| Pitfalls | HIGH | All 8 critical pitfalls are independently confirmed across multiple sources (official docs, PHP drivers, PCI DSS requirements). The dual ResponseCode+Approved check is confirmed in `omnipay-bpoint/Response.php`. |

**Overall confidence:** MEDIUM — sufficient to begin implementation. The core flow is well-understood. The gaps are narrow and bounded: v5-specific schema details that can only be confirmed against a live UAT connection, not architectural unknowns.

### Gaps to Address

- **UAT credentials (blocker):** No development or testing can proceed without BPoint UAT credentials. These are issued separately from production credentials and must be obtained from the firm before Phase 1 begins. If UAT credentials are unavailable, implementation must proceed against production in test mode (`IsTestTxn: true`) with extreme care.

- **v5 AuthKey endpoint path:** The v5 portal references `/v5/txn/authkey` but multiple third-party sources confirm the v2 equivalent at `/v2/txns/processtxnauthkey`. Both may work; use the first successful response from UAT as the canonical path and document it in `bpoint.ts`.

- **Webhook payload schema:** The exact JSON structure of BPoint's server-to-server callback is not publicly accessible. During Phase 4, make a test transaction in UAT with the callback URL configured, capture the raw POST body, and define the Zod schema from the actual payload.

- **BPoint Merchant Back Office access:** Configuring the server-to-server callback URL and creating the API user (`BPOINT_USERNAME`) requires access to the BPoint Merchant Back Office. Confirm the firm has an Administrator or Manager user who can complete this setup.

- **`Approved` field nesting:** The `omnipay-bpoint` PHP driver accesses `Approved` as `$response['TxnResp']['Approved']`. If the BPoint v5 response nests this differently, the dual-check function will need adjustment. Verify against the first UAT transaction response.

---

## Sources

### Primary (HIGH confidence)
- [CBA BPoint product page](https://www.commbank.com.au/business/payments/take-online-payments/bpoint-payment-gateway.html) — product status, existing-customer-only, Visa/MC acceptance
- [Spreedly BPoint Gateway Guide](https://docs.spreedly.com/payment-gateways/bpoint/) — 3DS not supported, supported transaction types confirmed
- [ACCC Card Surcharges](https://www.accc.gov.au/consumers/pricing/card-surcharges) — surcharge rules (firm absorbs, no pass-through needed)

### Secondary (MEDIUM confidence)
- [BPoint Developer Reference v2](https://www.bpoint.com.au/developers/v2/) — iframe URL format, IframeParameters, AuthKey creation, `processiframetxn` endpoint
- [BPoint Developer Reference v5](https://www.bpoint.com.au/developers/v5/api) — current API structure, webhook support reference (React SPA, partial content visible)
- [BPoint UAT environment](https://bpoint.uat.linkly.com.au/developers/v2/) — sandbox domain and test mode behaviour
- [omnipay-bpoint (wakeless-net)](https://github.com/wakeless-net/omnipay-bpoint) — `Response.php` confirms dual ResponseCode+Approved check pattern and field names in transaction response
- [omnipay-bpoint (digistorm)](https://github.com/digistorm/omnipay-bpoint) — v3 API structure cross-reference
- [BPoint v5 Bank Response Codes](https://www.bpoint.com.au/developers/v5/reference/bank-response-codes) — decline code reference for UI message mapping
- [BPoint API User setup](https://support.bpoint.com.au/hc/en-au/articles/43092031505945-How-to-Create-an-API-User) — credential format and Back Office setup steps

### Tertiary (LOW confidence — needs UAT validation)
- [BPoint v5 Webhooks](https://www.bpoint.com.au/developers/v5/api/webhooks) — webhook support confirmed to exist; payload schema behind React SPA
- [BPoint v5 iframe-fields](https://www.bpoint.com.au/developers/v5/api/txn/authkey/payment-method/iframe-fields) — v5 iframe integration mode exists; exact endpoint parameters need portal access

---

*Research completed: 2026-04-23*
*Ready for roadmap: yes*
