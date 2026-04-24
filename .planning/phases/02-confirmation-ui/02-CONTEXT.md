# Phase 2: Confirmation & UI - Context

**Gathered:** 2026-04-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Client enters card details in an embedded BPoint surface inside the chat, submits the payment, and the browser is redirected to `/api/checkout/confirm?ResultKey=...`. The confirm route calls BPoint's Retrieve Transaction API to verify the transaction authoritatively and then triggers the existing fan-out (upload token, client receipt email, firm transcript email). Declined or expired payments recover gracefully without losing the chat session. Phase 3 adds the server-to-server webhook that shares the same fan-out helper.

Out of scope (other phases):
- BPoint AuthKey creation endpoint — Phase 1 (done)
- Server-to-server webhook handler — Phase 3
- Stripe package removal — Phase 3
- UAT E2E test suite — Phase 4

</domain>

<decisions>
## Implementation Decisions

### Iframe integration mode
- **Single iframe embed**: `<iframe src="https://www.bpoint.com.au/webapi/v2/txns/iframe/{authKey}" />`. BPoint serves the whole card form; card data never touches our server. PCI SAQ-A.
- **Inline card layout**: renders as a bordered card attached to the AI's last message in the chat, same width as other messages. Matches how Stripe's EmbeddedCheckout appears today. Scrolls with chat (no sticky panel, no modal).
- **No brand customization of the iframe content** — accept BPoint's default form styling. Our PaymentCard wrapper can stay brand-neutral; the chat message carrying it provides brand context.
- **CSP swap**: drop Stripe origins (`js.stripe.com`, `m.stripe.network`) from `frame-src`/`script-src` in this phase; add `www.bpoint.com.au`. Phase 3 removes Stripe anyway — no reason to keep stale CSP entries.

### Failure message strategy
- **3 buckets** mapped from BPoint `APIResponse.ResponseCode`/`ResponseText`:
  - "Card declined — please try another card." (declined/insufficient funds/expired card codes)
  - "Invalid card details — please check and try again." (CVV/PAN/expiry format codes)
  - "Payment couldn't be processed right now — please try again in a moment." (system/network/unknown codes)
- **Retry uses the same AuthKey** — within the 30min TTL, the iframe is simply re-rendered. No new `POST /api/checkout` call on retry unless the AuthKey has expired.
- **No retry limit** — low-value protection against card-testing vs high cost to legitimate users.
- **BPoint ResponseCode never shown in the UI** — logged server-side with `bpointTxnNumber` tag so support can correlate via server logs if a client calls.
- **No client-side validation** — BPoint's iframe handles Luhn/expiry/CVV format. Enable the Pay button when the iframe reports ready.

### Fan-out trigger boundary
- **Confirm route is primary**: `GET /api/checkout/confirm` (browser redirect from BPoint) runs the fan-out first for instant user confirmation.
- **Phase 3 webhook is a safety net**: fires the same fan-out if the browser redirect never lands (user closes tab, intermittent connection).
- **Dedup key: `bpointTxnNumber`**. Redis key pattern `bpoint-txn:{txnNumber}`, TTL 7 days (matches existing `stripe-session:*` pattern from `.planning/research/ARCHITECTURE.md`). Dedup scope = the final settled transaction ID, not the AuthKey or sessionId — a single session can legitimately retry multiple times before one settles.
- **Shared helper location**: `src/lib/payments/handleConfirmedPayment.ts`. Both `GET /api/checkout/confirm` and (Phase 3) `POST /api/webhooks/bpoint` import it. Matches ROADMAP.md Phase 3 SC#2 language.
- **Dual verification before fan-out** (CONF-03): both `APIResponse.ResponseCode === "0"` AND `Approved === true` must be true. Either false → treat as declined.

### AuthKey expiry UX
- **Detection is reactive** — no client-side timer. When BPoint returns the expired-AuthKey response code on submit, catch it and show the expiry UI.
- **Button click to refresh** — "Payment session expired" + explicit "Start again" button. No silent auto-refresh (could interrupt typing); no full page reload (loses chat state).
- **No new endpoint needed** — fresh `POST /api/checkout` with the same `sessionId` creates a new AuthKey and overwrites `bpointTxnNumber` via `updateIntake`. Phase 1's code already supports this with zero changes.
- **Overwrite prior AuthKey** on intake — no history array, no "abandoned" status. The prior AuthKey was never paid against (would've succeeded otherwise); support retains forensic visibility via server logs.

### Claude's Discretion
- Exact copy of the "Start again" button label and the failure-message phrasing within the 3 buckets
- Loading / processing state visual (spinner, progress indicator) between iframe submit and redirect
- Iframe height/width sizing and mobile viewport behavior
- Exact BPoint ResponseCode → bucket mapping (Claude will map to the 3 buckets during planning based on BPoint's documented codes; any ambiguous code defaults to bucket 3)
- Whether Redis dedup is implemented as SETNX + TTL, a Lua script, or Upstash's atomic primitives
- Log format and fields (as long as `bpointTxnNumber` is the correlation tag)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap + requirements
- `.planning/ROADMAP.md` §Phase 2 — goal, success criteria 1–5 (iframe renders, ResultKey verification, fan-out, declined UX, expiry retry)
- `.planning/REQUIREMENTS.md` — CONF-01 through CONF-05, UI-01 through UI-04 line items
- `.planning/PROJECT.md` — firm principles, non-negotiables
- `.planning/phases/01-foundation/01-CONTEXT.md` — Phase 1 locked decisions (BPoint client API shape, pricing module, Redis field rename)
- `.planning/phases/01-foundation/01-VERIFICATION.md` — Phase 1 external blocker (BPoint HPP product activation); code fixes discovered during verification (URL path, ProcessTxnData wrapper, prod-only host, APIResponse-based response parser)

### Technical research
- `.planning/research/ARCHITECTURE.md` — target architecture; confirm-route + webhook helper pattern, Redis dedup keys
- `.planning/research/FEATURES.md` — BPoint feature landscape, Stripe→BPoint replacement map
- `.planning/research/PITFALLS.md` — known gotchas (unsigned callback, deduplication, v5 webhook schema unknown until captured)
- `.planning/research/STACK.md` — iframe URL pattern `/webapi/v2/txns/iframe/{authKey}`, Basic Auth format confirmed in Phase 1

### Codebase maps
- `.planning/codebase/CONVENTIONS.md` — naming conventions, error-tag brackets, client factory pattern
- `.planning/codebase/STRUCTURE.md` — where `src/lib/payments/handleConfirmedPayment.ts` and `src/app/api/checkout/confirm/route.ts` belong
- `.planning/codebase/INTEGRATIONS.md` — Resend + Zapier contract, existing upload-token flow, Redis session shape
- `.planning/codebase/ARCHITECTURE.md` — how fan-out integrates with intake + Resend + Zapier today

### Existing code to read before modifying
- `src/components/payment/payment-card.tsx` — current Stripe EmbeddedCheckout implementation; replace with BPoint iframe
- `src/app/api/webhooks/stripe/route.ts` §L85–L130 — existing fan-out logic (upload token, PaymentReceipt email, sendTranscriptEmail). Extract to `handleConfirmedPayment.ts`.
- `src/app/api/checkout/route.ts` — Phase 1's BPoint AuthKey endpoint; confirm route consumes its `{ authKey }` contract
- `src/lib/bpoint.ts` — add `retrieveTransaction(resultKey)` helper here for CONF-02 verification

### External (for researcher reference only)
- BPoint Retrieve Transaction API (v2) — authoritative verification endpoint for CONF-02
- BPoint iframe URL format confirmed: `https://www.bpoint.com.au/webapi/v2/txns/iframe/{authKey}` (from `.planning/research/STACK.md`)
- Next.js CSP headers documentation — for UI-03 header swap

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/app/api/webhooks/stripe/route.ts:85–130` — existing fan-out logic (upload token creation, `PaymentReceipt` React email via Resend, `sendTranscriptEmail` to Zapier). Extract into `src/lib/payments/handleConfirmedPayment.ts` accepting `{ sessionId, bpointTxnNumber, amountCents }`.
- `src/components/payment/payment-card.tsx` — current Stripe `EmbeddedCheckoutProvider`/`EmbeddedCheckout` wiring. Replace inner implementation with a single `<iframe>`; keep the outer card shell + error state structure.
- `src/lib/bpoint.ts` — Phase 1's BPoint client. Add `retrieveTransaction(resultKey: string)` alongside existing `createAuthKey`. Reuse `getBpointConfig()` + `buildBpointAuthHeader()` helpers.
- `src/lib/kv.ts` — existing Redis session helpers; add a thin `acquireDedupLock(key, ttl)` or inline SETNX pattern for the `bpoint-txn:{txnNumber}` key.
- `src/emails/PaymentReceipt.tsx` (if exists) + `src/lib/resend.ts` — receipt email send path already wired, reusable.
- `src/lib/intake.ts` — `updateIntake(sessionId, partial)` used on both success (set `paidAt`, `amountPaid`) and on AuthKey refresh (overwrite `bpointTxnNumber`).

### Established Patterns
- **Lazy-singleton client factories** (Phase 1 `getBpointConfig()` per-call pattern) — apply the same per-call pattern to any new BPoint helpers.
- **Error-tag bracket prefix** in logs (`[bpoint]`, `[checkout]`, `[stripe-webhook]`) — use `[bpoint-confirm]` for the confirm route and `[payments]` for the shared helper.
- **Webhook returns 200 regardless** of fan-out success (stripe webhook precedent). Same for confirm route redirect — always complete the user-facing redirect, log + dedup handle backend failures.
- **No default exports** — named exports only for the new `handleConfirmedPayment`, `retrieveTransaction`, and confirm-route handler.

### Integration Points
- **Confirm route entry:** `GET /api/checkout/confirm` reads `ResultKey` from query string, calls `retrieveTransaction`, gates on dual-verification, then calls `handleConfirmedPayment`.
- **PaymentCard → /api/checkout:** already wired in Phase 1; PaymentCard consumes `{ authKey }` response, mounts iframe with that UUID.
- **handleConfirmedPayment → Resend:** existing `resend.emails.send` pattern with `PaymentReceipt` React email component.
- **handleConfirmedPayment → Zapier:** existing `sendTranscriptEmail` helper already expects `bpointTxnNumber` (Phase 1 field rename done).
- **handleConfirmedPayment → upload token:** existing `createUploadToken(sessionId)` helper.

</code_context>

<specifics>
## Specific Ideas

- BPoint's iframe should feel like it "belongs" in the chat message, not like a separate checkout page. The surrounding PaymentCard renders like any other AI message attachment.
- "Start again" button after expiry should be as explicit as possible — no assumption that the user knows what happened. The copy should say the session expired, not that there was a "problem".
- Server logs are the support backchannel — `bpointTxnNumber` + timestamp + ResponseCode in structured JSON so support can find a client's attempt without trawling.

</specifics>

<deferred>
## Deferred Ideas

- Proactive client-side expiry timer with 25min soft-warning — could be added later if clients report confusion; not worth the code in v1 (reactive is sufficient).
- BPoint transparent iframe-fields for full visual control — not needed now (single iframe is enough, less risk), revisit if Aquarius wants a highly branded payment form.
- Card-testing rate limit (N attempts per session) — defensive feature, implement only if abuse materializes.
- Status field tracking old AuthKey records as "abandoned" — not needed with overwrite strategy; reconsider if audit requirements change.
- Post-payment UI micro-interactions (confetti, checkmark animation, etc.) — out of scope for this phase; basic success state is sufficient.
- "See details" expandable with BPoint raw text for support — rejected in favor of server-log correlation; reconsider if support is overwhelmed by unclear errors.

</deferred>

---

*Phase: 02-confirmation-ui*
*Context gathered: 2026-04-24*
