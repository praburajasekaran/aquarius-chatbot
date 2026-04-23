# Stack Research

**Domain:** BPoint embedded payment integration — Next.js 15 (App Router, TypeScript)
**Researched:** 2026-04-23
**Confidence:** MEDIUM — BPoint's v5 developer portal is a React SPA whose content does not surface in web searches; key structural facts are confirmed from multiple secondary sources and crawlable v2/v3 docs, but some v5-specific endpoint details require direct portal access to verify.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| BPoint REST API | v5 (current) | Payment session creation, transaction processing, webhook events | v5 is the current documented API on `bpoint.com.au/developers/v5`. v2 remains available but v5 is what new docs reference. No npm SDK exists — raw REST calls are the only option. |
| Next.js Route Handlers | 15 (App Router) | Server-side: create AuthKey, process iframe payment, verify transaction result | BPoint requires the AuthKey to be created server-side (credentials must never be exposed to the browser). App Router Route Handlers (`app/api/*/route.ts`) are the right primitive. |
| BPoint iframe (v2/v5) | — | Client-side embedded payment form | BPoint's iframe is a hosted PCI-compliant card-capture form. Embedding it keeps card data off your server entirely — the correct choice for this app's UX requirement (embedded, not a redirect). |
| Upstash Redis | existing | Session state, deduplication token | Already in use. Store `bpointAuthKey`, `txnNumber`, `paidAt` alongside existing session fields. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node-fetch` / native `fetch` | Node 18+ built-in | Server-side HTTP calls to BPoint REST API | Use native `fetch` in Route Handlers — no extra dependency needed in Next.js 15. |
| `zod` | existing | Validate BPoint webhook payloads before processing | Already in project. Add a schema for the `TxnResp` object to guard the webhook handler. |
| `crypto` (Node built-in) | built-in | Webhook HMAC verification if BPoint sends a signature header | No extra install. BPoint v5 webhook docs list supported events; signature verification details need confirming in the portal. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `bpoint.uat.linkly.com.au` | UAT/sandbox environment | Full mirror of production. Use UAT base URL (`https://bpoint.uat.linkly.com.au/webapi/`) during development. Separate credentials required — issued by BPoint on account setup. |
| BPoint Back Office (UAT) | Test transaction inspection | `https://bpoint.uat.linkly.com.au/backoffice` — view transaction history and verify webhook delivery during development. |

---

## Integration Methods — Current Status (2025)

BPoint offers three front-end integration styles. Only one is appropriate for this project.

### Method 1: Hosted Redirect (3-Party) — NOT recommended

The browser is redirected to `https://www.bpoint.com.au/pay/{authKey}`. Payment happens on BPoint's domain and the user is returned to a `RedirectionUrl` afterwards.

**Why not:** Breaks the chat-embedded UX. The client leaves the chat, breaking session continuity. Does not match the existing Stripe Embedded Checkout pattern this milestone is replacing.

### Method 2: iframe Embed — RECOMMENDED

An AuthKey is created server-side. A `<iframe src="https://www.bpoint.com.au/webapi/v2/txns/iframe/{authKey}" />` is rendered inside `PaymentCard`. BPoint serves the card-entry form from its own domain. Card data never touches your server — full PCI compliance without SAQ-D.

Two operational sub-modes:

| Sub-mode | `ShowSubmitButton` | How payment is triggered | Use |
|----------|-------------------|--------------------------|-----|
| Submit-button mode | `true` | User clicks BPoint's own Submit button inside iframe; iframe redirects internally to `RedirectionUrl` | Simpler but less control over UX |
| Single-page mode | `false` (default) | Your page calls `processiframetxn` endpoint via a server-to-server call; no internal redirect | Recommended — lets you control the "Pay" button outside the iframe, matching chat UX |

**Single-page mode flow:**
1. Server creates AuthKey (`POST /webapi/v2/txns/processtxnauthkey`) — returns `authKey` UUID.
2. Browser renders `<iframe src="…/iframe/{authKey}" />` — user enters card details; BPoint stores them against the authKey session server-side.
3. User clicks your "Pay" button (outside iframe, in React).
4. Your server calls `POST /webapi/v2/txns/processiframetxn` with `{ AuthKey: "…" }` — BPoint charges the stored card details.
5. Your server calls `GET /webapi/v2/txns/{txnNumber}` to retrieve and verify the final transaction result.
6. Session in Redis is updated; downstream workflows fire.

### Method 3: JavaScript Fields — NOT recommended for this project

BPoint loads a JavaScript library that replaces standard `<input>` elements with hosted iframes per-field (card number, expiry, CVV as separate iframes). More flexible styling; more complex integration. Appropriate when fine-grained CSS control of individual fields is required.

**Why not now:** Added complexity for no UX gain. The single-iframe approach is simpler to implement and maintain. Revisit if design requires custom-styled card fields that must visually match the chat theme exactly.

---

## Authentication

BPoint uses HTTP Basic Auth with a composite credential format.

```
Authorization: Basic base64("username|merchantNumber:password")
```

- `username` — API user created in BPoint Back Office (not the main login)
- `merchantNumber` — BPoint-issued merchant identifier
- `password` — API user password

**Important:** Create a dedicated API user in Back Office with minimum required permissions (transaction processing only). Do not use the admin login credentials in code.

All credential values go in `.env.local` (never committed):

```
BPOINT_USERNAME=apiuser@firm
BPOINT_MERCHANT_NUMBER=1234567
BPOINT_PASSWORD=secret
BPOINT_BASE_URL=https://www.bpoint.com.au/webapi   # production
# BPOINT_BASE_URL=https://bpoint.uat.linkly.com.au/webapi  # UAT
```

---

## Key API Endpoints

All endpoints are relative to `BPOINT_BASE_URL`.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v2/txns/processtxnauthkey` | POST | Create AuthKey for an iframe session. Body includes `Amount`, `Crn1` (reference), `TxnType: "payment"`, `IframeParameters`. Returns `AuthKey` UUID. |
| `/v2/txns/iframe/{authKey}` | — | iframe `src` URL — not called by your code, loaded by the browser. |
| `/v2/txns/processiframetxn` | POST | Trigger payment on server after user has entered card details in iframe. Body: `{ AuthKey: "…" }`. Returns transaction result. |
| `/v2/txns/{txnNumber}` | GET | Retrieve a specific transaction by number. Use to verify payment result after processing. |
| `/v5/api/webhooks` | — | BPoint v5 webhook configuration. Specific events and payload schema require confirmation in the developer portal. |

Confidence: MEDIUM — v2 endpoints confirmed from multiple sources including community implementations and crawlable partial docs. v5 endpoint paths require verification in the portal.

---

## Webhook vs Poll — Payment Verification Strategy

BPoint does not have a Stripe-style webhook-first model that is well-documented in public sources. Two approaches are viable:

**Approach A: Server-side poll after `processiframetxn` (recommended for MVP)**
The `processiframetxn` call itself returns the transaction result synchronously. Read the `ResponseCode` and `TxnNumber` from the response body directly — no webhook required for the payment confirmation path. Use the transaction result in the Route Handler response to update Redis and trigger downstream workflows.

**Approach B: BPoint v5 Webhooks (for resilience)**
BPoint v5 documents webhook support at `/v5/api/webhooks`. Use as a backup/reconciliation path — if the server-side call succeeds but the client loses connection, a webhook can re-trigger the post-payment workflow. Requires HMAC verification of incoming payloads. Implement after the core flow is working.

**Recommendation:** Ship with Approach A (synchronous response from `processiframetxn`). Add Approach B webhook handler for deduplication-safe retry resilience, guarded by the existing Redis deduplication pattern.

---

## Installation

No npm packages specific to BPoint are required. The integration is pure REST + native fetch.

```bash
# No new dependencies needed — existing stack is sufficient:
# - fetch (Node 18+ built-in, available in Next.js 15 Route Handlers)
# - zod (already installed, use for webhook payload validation)
# - crypto (Node built-in, use for HMAC webhook signature verification)
```

If a typed HTTP client is preferred for maintainability:

```bash
# Optional — only if team wants typed REST client ergonomics
npm install ky
```

`ky` is a small fetch wrapper with retry support. It is not required.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| BPoint iframe (single-page mode) | BPoint hosted redirect (3-party) | Only if keeping the user on BPoint's page is acceptable (never for this chat UX) |
| BPoint iframe (single-page mode) | BPoint JavaScript fields | If per-field CSS control is required and development time is available for the additional complexity |
| Native fetch + Route Handler | `omnipay-bpoint` PHP library | PHP projects only — this is a Node.js/Next.js project |
| Raw REST | Spreedly as BPoint proxy | Only if multi-gateway abstraction is needed — unnecessary overhead here |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| BPoint hosted redirect (3-party) | User leaves the chat; session continuity is broken; UX regression from Stripe Embedded Checkout | BPoint iframe embed |
| BPoint JavaScript fields for MVP | Three separate iframes (card, expiry, CVV) — significantly more integration surface area for no user-visible benefit in this design | Single iframe embed |
| PowerBoard (CommBank) | Being sunsetted alongside BPOINT for new customers; separate product | Stay on BPOINT — the firm is already an existing customer |
| Direct card POST to your server | Puts raw card data in scope for PCI SAQ-D; illegal without full PCI certification | BPoint iframe keeps card data on BPoint's servers |
| CommBank's older CommWeb gateway | Deprecated alongside BPOINT new-customer sign-ups | BPOINT — existing account already provisioned |
| `omnipay-bpoint` PHP packages | PHP only; multiple forks with varying v2/v3/v5 support; no Node equivalent | Direct REST calls via native fetch |

---

## Version Compatibility

| Component | Compatible With | Notes |
|-----------|-----------------|-------|
| BPoint API v2 | All Node.js versions, Next.js 13+ | Most publicly documented. iframe and `processiframetxn` endpoints confirmed here. |
| BPoint API v5 | All Node.js versions, Next.js 13+ | Current version per official docs. Webhook support. Superset of v2 capabilities. Use v5 endpoints where documented, fall back to v2 for iframe processing. |
| BPoint UAT domain | `bpoint.uat.linkly.com.au` | Separate from production. Requires UAT credentials — not the same as production creds. |
| Next.js 15 App Router Route Handlers | BPoint REST API | No conflict. Route Handlers run in Node.js runtime with full fetch access. Do not use Edge Runtime — BPoint auth requires `crypto` and `Buffer` which are not available in Edge. |

---

## Stack Patterns by Variant

**If the firm requires a custom-styled card form matching the chat design exactly:**
- Switch to JavaScript Fields method
- Requires loading BPoint's JS library, replacing three input fields with iframe stubs, and coordinating three field-readiness events before enabling submit

**If BPoint payment status needs to be polled (e.g. mobile background tab):**
- Add a `/api/payment-status` Route Handler that reads from Redis
- Client polls every 2 seconds after showing the iframe; Route Handler returns `{ paid: true }` once Redis session is updated

**If multiple merchants or matters need separate BPoint accounts:**
- Pass different credentials per merchant — BPoint is merchant-number scoped
- One API user can serve one merchant number; multi-tenant requires multiple credential sets

---

## Sources

- [BPoint Developer Reference v2](https://www.bpoint.com.au/developers/v2/) — iframe URL format, IframeParameters, AuthKey creation, processiframetxn endpoint — MEDIUM confidence (partial content visible)
- [BPoint Developer Reference v5](https://www.bpoint.com.au/developers/v5/api) — current API structure, webhook support, transaction authkey — LOW-MEDIUM confidence (React SPA, content not crawlable; structure confirmed from URL patterns)
- [BPoint UAT Linkly](https://bpoint.uat.linkly.com.au/developers/v2/) — confirms sandbox environment at Linkly-managed domain — MEDIUM confidence
- [BPoint v5 Iframe Fields (txn)](https://www.bpoint.com.au/developers/v5/api/txn/authkey/payment-method/iframe-fields) — existence of iframe fields method in v5 — MEDIUM confidence
- [BPoint v5 Webhook docs](https://www.bpoint.com.au/developers/v5/api/webhooks) — webhook support exists in v5 — LOW confidence (page confirmed, content not crawlable)
- [BPoint v5 Integrate Authentication](https://www.bpoint.com.au/developers/v5/api/txn/authkey/authentication) — auth endpoint and credential format — MEDIUM confidence
- [CommBank BPOINT overview](https://www.commbank.com.au/business/payments/take-online-payments/bpoint-payment-gateway.html) — confirms BPOINT closed to new customers; existing customers supported — HIGH confidence
- [omnipay-bpoint (PatronBase)](https://github.com/PatronBase/omnipay-bpoint) — PHP implementation confirms redirect-only (3-party) via Omnipay; confirms no Node SDK exists — MEDIUM confidence
- [omnipay-bpoint (digistorm)](https://github.com/digistorm/omnipay-bpoint) — PHP v3 driver; confirms API structure — MEDIUM confidence
- [Spreedly BPoint Gateway Guide](https://docs.spreedly.com/payment-gateways/bpoint/) — third-party gateway integration confirms BPOINT REST API basics — MEDIUM confidence
- [Webcastcloud BPOINT integration](https://support.webcastcloud.com/hc/en-us/articles/4408047238159-BPOINT-Payment-Gateway-Integration) — confirms hosted page vs embedded choice — MEDIUM confidence

---

*Stack research for: BPoint embedded payment integration in Next.js 15 chat application*
*Researched: 2026-04-23*
