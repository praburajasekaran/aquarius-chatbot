# Architecture Research

**Domain:** Payment processor swap — Stripe Embedded Checkout to BPoint iframe
**Researched:** 2026-04-23
**Confidence:** MEDIUM — BPoint v5 docs are React SPAs not fully indexed by search; flow confirmed via multiple third-party integrations, official partial content, and Omnipay PHP driver source

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser (Client)                         │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  PaymentCard component                                    │   │
│  │  - Renders pricing tier + legal disclosure               │   │
│  │  - Calls POST /api/checkout → receives { authKey }       │   │
│  │  - Renders <iframe src="bpoint.com.au/...?authKey=...">  │   │
│  │  - Listens for iframe redirect to /api/checkout/confirm  │   │
│  └──────────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTPS
┌───────────────────────────▼─────────────────────────────────────┐
│                    Next.js API Routes                            │
│                                                                  │
│  POST /api/checkout          POST /api/checkout/confirm          │
│  (server → BPoint:           (redirect landing from BPoint       │
│   create AuthKey)             iframe; server → BPoint:           │
│                               retrieve result by ResultKey)      │
│                                                                  │
│  POST /api/webhooks/bpoint   GET /api/checkout/resume            │
│  (optional server-to-server  (email link resumption — check      │
│   BPoint callback)            intake, regenerate authKey)        │
└───┬──────────────────────┬──────────────────────────────────────┘
    │                      │
    │ Redis                │ BPoint REST API
    ▼                      ▼
┌────────────┐    ┌──────────────────────────────────────────────┐
│  Upstash   │    │  BPoint (Commonwealth Bank)                  │
│  Redis     │    │  POST /v5/txn/authkey   (create AuthKey)     │
│            │    │  GET  /v5/txn/{ResultKey} (retrieve result)  │
│  session:* │    │  POST /v5/txn           (webhook callback)   │
│  intake:*  │    └──────────────────────────────────────────────┘
│  dedupe:*  │
└────────────┘
     │
     │ After confirmed payment
     ▼
┌─────────────────────────────────────────────────────────────────┐
│  Fan-out (same as existing Stripe post-payment flow)            │
│  1. createUploadToken()                                          │
│  2. resend: payment receipt → client                            │
│  3. resend: transcript email → firm (Zapier picks up)           │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Changes from Stripe |
|-----------|----------------|---------------------|
| `PaymentCard` | Renders pricing, legal text, payment UI | Replace `EmbeddedCheckoutProvider`/`EmbeddedCheckout` with `<iframe>` pointing to BPoint-hosted form. Remove `loadStripe`. Add `onComplete` via redirect detection. |
| `POST /api/checkout` | Create payment session, return credential to client | Replace Stripe session creation with BPoint AuthKey creation (server → BPoint API). Return `{ authKey }` instead of `{ clientSecret }`. |
| `GET /api/checkout/confirm` | Land from BPoint iframe redirect, verify payment server-side | New route. Receives `ResultKey` + `ResponseCode` in query string. Calls BPoint retrieve-result API. Triggers fan-out on success. |
| `POST /api/webhooks/bpoint` | Optional server-to-server confirmation from BPoint | Replaces `/api/webhooks/stripe`. Handles BPoint server callback (if configured in BPoint merchant portal). No Stripe HMAC — BPoint uses Basic Auth or shared secret on the callback URL. |
| `GET /api/checkout/resume` | Re-entry via email link when session still open | Replaces Stripe session retrieval with BPoint intake lookup. Regenerates a new AuthKey if prior one expired; redirects to BPoint hosted page. |
| `src/lib/bpoint.ts` | BPoint API client (replaces `src/lib/stripe.ts`) | New file. Encapsulates AuthKey creation, result retrieval, Basic Auth headers, PRICING constants. |
| `src/types/index.ts` | Session + intake schema | Rename `stripeSessionId` → `bpointTxnNumber` (or add alongside for migration). |
| `src/lib/intake.ts` | Intake record schema | Rename `stripeSessionId` → `bpointTxnNumber`. |
| `src/lib/resend.ts` | `sendTranscriptEmail` | Rename `stripeSessionId` param → `bpointTxnNumber`. Zapier email field label changes from "Stripe Session" to "BPoint Transaction". |

## Recommended Project Structure

```
src/
├── app/
│   └── api/
│       ├── checkout/
│       │   ├── route.ts          # MODIFY: BPoint AuthKey creation
│       │   ├── confirm/
│       │   │   └── route.ts      # NEW: ResultKey landing + server-side retrieval
│       │   └── resume/
│       │       └── route.ts      # MODIFY: swap Stripe retrieve → BPoint AuthKey regenerate
│       └── webhooks/
│           └── bpoint/
│               └── route.ts      # NEW (replaces stripe/): BPoint server callback
├── components/
│   └── payment/
│       └── payment-card.tsx      # MODIFY: iframe replaces EmbeddedCheckoutProvider
├── lib/
│   ├── bpoint.ts                 # NEW: replaces stripe.ts
│   ├── stripe.ts                 # REMOVE after cutover
│   ├── intake.ts                 # MODIFY: stripeSessionId → bpointTxnNumber
│   ├── kv.ts                     # MODIFY: SessionData field rename
│   └── resend.ts                 # MODIFY: param + email label rename
└── types/
    └── index.ts                  # MODIFY: SessionData + IntakeRecord field rename
```

### Structure Rationale

- **`/api/checkout/confirm/`**: BPoint uses redirect-based result delivery (not a clientSecret poll), so a dedicated confirm route is needed. This is the equivalent of Stripe's `?payment=success` return URL handler — but it must also call BPoint to retrieve the authoritative result before triggering fan-out.
- **`/api/webhooks/bpoint/`**: BPoint optionally fires a server-to-server POST after a transaction. Keep as a secondary confirmation path — the primary path is the confirm redirect. Deduplication in Redis prevents double fan-out.
- **`src/lib/bpoint.ts`**: Isolated in its own module following the same singleton pattern as `stripe.ts`, so the checkout and webhook routes import a clean interface.

## Architectural Patterns

### Pattern 1: AuthKey-Then-Iframe (BPoint's 3-Party Flow)

**What:** Server creates a time-limited AuthKey that encodes the amount, Crn1 (your session ID), and a `RedirectionUrl`. Client renders BPoint's hosted iframe using that AuthKey as URL parameter. Card data never touches your server — BPoint captures it. After payment, BPoint redirects the iframe (or top frame) to `RedirectionUrl?ResponseCode=0&ResultKey=<uuid>`.

**When to use:** Always — this is BPoint's standard embedded browser integration (v5 `txn/authkey` + iframe-fields or HPP mode).

**Trade-offs:** No client-secret/JS SDK polling like Stripe; result is URL-based. Adds a confirm redirect route not needed in Stripe flow. Pro: PCI scope reduction is equivalent. Con: iframe redirect UX differs slightly from Stripe's seamless embedded completion.

**Example — AuthKey creation (server-side `src/lib/bpoint.ts`):**
```typescript
export async function createBPointAuthKey(args: {
  sessionId: string;
  urgency: "urgent" | "non-urgent";
  confirmUrlBase: string;
}): Promise<string> {
  const pricing = PRICING[args.urgency];
  const res = await fetch(`${BPOINT_API_BASE}/v5/txn/authkey`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: buildBasicAuth(), // Base64(username:password)
    },
    body: JSON.stringify({
      TxnType: "payment",
      Amount: pricing.amount,           // cents e.g. 132000
      Currency: "AUD",
      Crn1: args.sessionId,             // your session ID (metadata carrier)
      MerchantReference: pricing.lineItem, // exact lineItem string
      RedirectionUrl: `${args.confirmUrlBase}/api/checkout/confirm`,
      // IframeParameters: { ShowSubmitButton: true } — if using iframe-fields mode
    }),
  });
  const data = await res.json();
  return data.AuthKey; // UUID string
}
```

**Example — PaymentCard iframe rendering:**
```typescript
// Replace EmbeddedCheckoutProvider entirely
const iframeSrc = `https://www.bpoint.com.au/pay/${merchantNumber}?authkey=${authKey}`;
return (
  <iframe
    src={iframeSrc}
    title="Secure payment"
    className="w-full rounded-lg border border-gray-200"
    style={{ minHeight: 480 }}
  />
);
```

### Pattern 2: Server-Side Result Retrieval on Redirect Landing

**What:** After BPoint redirects to `/api/checkout/confirm?ResponseCode=0&ResultKey=<uuid>`, the server immediately calls BPoint's retrieve-result endpoint using `ResultKey`. This is the authoritative payment confirmation — do not trust `ResponseCode` alone (it could be forged in the URL).

**When to use:** Always. `ResponseCode=0` in the redirect URL is client-visible and not authenticated. The retrieve call uses your server credentials and returns the full transaction record including `TxnNumber`, `ReceiptNumber`, `AmountInCents`.

**Trade-offs:** Adds one server-to-BPoint round-trip on the redirect. Necessary for security. Means the confirm route must be a proper page/API endpoint, not a static redirect.

**Example — confirm route:**
```typescript
// GET /api/checkout/confirm?ResultKey=...&ResponseCode=...
export async function GET(req: NextRequest) {
  const resultKey = req.nextUrl.searchParams.get("ResultKey");
  const responseCode = req.nextUrl.searchParams.get("ResponseCode");

  if (!resultKey || responseCode !== "0") {
    return NextResponse.redirect(`${appUrl}/?payment=failed`);
  }

  // Authoritative server-side verification
  const txn = await retrieveBPointResult(resultKey);
  if (txn.ResponseCode !== "0" || !txn.Crn1) {
    return NextResponse.redirect(`${appUrl}/?payment=failed`);
  }

  // Deduplicate and fan-out (same pattern as existing Stripe webhook)
  const dedupeKey = `bpoint-txn:${txn.TxnNumber}`;
  const created = await redis.set(dedupeKey, "pending", { nx: true, ex: DEDUPE_TTL });
  if (created !== "OK") {
    return NextResponse.redirect(`${appUrl}/?payment=success`);
  }

  await updateSession(txn.Crn1, {
    paymentStatus: "paid",
    bpointTxnNumber: txn.TxnNumber,
    paymentAmount: txn.AmountInCents,
  });
  // createUploadToken → receipt email → transcript email (unchanged)
  ...
}
```

### Pattern 3: Webhook as Secondary Confirmation (Deduplication Guard)

**What:** BPoint can be configured in the merchant portal to POST a server-to-server callback after each transaction. This is NOT the primary confirmation path (that is the confirm redirect). The webhook handler deduplicates via Redis — if the redirect already processed the transaction, the webhook is a no-op.

**When to use:** Configure it for resilience (handles cases where the client's browser never completes the redirect, e.g., connection drops after payment). Not a replacement for the confirm route.

**Trade-offs:** BPoint's webhook does not use HMAC signing. Authentication is via a secret embedded in the callback URL (query param) or IP allowlisting of BPoint's server IPs. Simpler than Stripe's `constructEvent` but requires URL-secret approach.

**Example — webhook deduplication:**
```typescript
// POST /api/webhooks/bpoint
export async function POST(req: Request) {
  // BPoint has no HMAC header — authenticate via shared secret in URL
  const secret = new URL(req.url).searchParams.get("secret");
  if (secret !== process.env.BPOINT_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const txnNumber = body.TxnNumber;
  const crn1 = body.Crn1; // your sessionId

  const dedupeKey = `bpoint-txn:${txnNumber}`;
  const created = await redis.set(dedupeKey, "pending", { nx: true, ex: DEDUPE_TTL });
  if (created !== "OK") {
    // Already handled by confirm redirect
    return NextResponse.json({ received: true });
  }
  // Fan-out (same as confirm route)
  ...
}
```

## Data Flow

### Payment Initiation Flow

```
Client clicks "Pay now"
    ↓
PaymentCard mounts
    ↓
POST /api/checkout { sessionId, urgency }
    ↓
Server: POST BPoint /v5/txn/authkey
        { Amount, Currency: "AUD", Crn1: sessionId,
          MerchantReference: lineItem, RedirectionUrl }
    ↓
BPoint returns { AuthKey: "uuid" }
    ↓
Server stores authKey in intake (optional) → responds { authKey }
    ↓
Client renders <iframe src="bpoint.com.au/pay/{merchant}?authkey={authKey}">
    ↓
Client enters card details in BPoint-hosted iframe
    ↓
BPoint processes payment → iframe top-frame redirect to:
  /api/checkout/confirm?ResponseCode=0&ResultKey=uuid
```

### Payment Confirmation Flow

```
Browser lands on /api/checkout/confirm?ResponseCode=0&ResultKey=uuid
    ↓
Server: GET BPoint /v5/txn/{ResultKey}  (authoritative verification)
    ↓
BPoint returns TxnNumber, AmountInCents, Crn1 (=sessionId), ResponseCode
    ↓
Redis: SET bpoint-txn:{TxnNumber} "pending" NX  (deduplication gate)
    ↓ (if created = "OK")
updateSession(sessionId, { paymentStatus:"paid", bpointTxnNumber, paymentAmount })
updateIntake(sessionId, { bpointTxnNumber })
    ↓
createUploadToken({ matterRef: sessionId, clientEmail, clientName })
    ↓
Redis: SET bpoint-txn:{TxnNumber} hash(token)  (replace pending)
    ↓
resend: payment receipt email → clientEmail
resend: transcript email → firm (Zapier trigger)
    ↓
NextResponse.redirect("/?payment=success")
```

### Key Data Mappings

| Stripe Field | BPoint Equivalent | Notes |
|---|---|---|
| `checkout.session.id` | `TxnNumber` | BPoint's unique transaction identifier |
| `session.metadata.sessionId` | `Crn1` | Your session ID, passed into AuthKey |
| `session.amount_total` (cents) | `AmountInCents` | Same unit — cents AUD |
| `session.customer_details.email` | Not in BPoint response | Must read from `intake` using Crn1 |
| `session.customer_details.name` | Not in BPoint response | Must read from `intake` using Crn1 |
| `clientSecret` | `authKey` | Token passed to browser to initiate form |
| `stripe-signature` header | URL `?secret=` param | BPoint has no HMAC signing on webhooks |
| `checkout.session.completed` event | `ResponseCode = "0"` | BPoint success indicator |

### State Management

```
Redis keys used:
  session:{sessionId}     — SessionData (paymentStatus, bpointTxnNumber, paymentAmount)
  intake:{sessionId}      — IntakeRecord (bpointTxnNumber, client details)
  bpoint-txn:{TxnNumber}  — Dedup record ("pending" → token hash)
                             TTL: 7 days (same as existing stripe-session:* keys)
```

## Scaling Considerations

| Scale | Architecture Adjustment |
|-------|------------------------|
| Current (small firm, ~10 payments/day) | Single confirm route + optional webhook is sufficient. No queue needed. |
| Medium (hundreds/day) | Add timeout handling on the BPoint retrieve call. Confirm route already idempotent via Redis dedupe. |
| High volume | Not applicable — single-firm legal chatbot. |

### Scaling Priorities

1. **First bottleneck:** BPoint AuthKey TTL (30 minutes per PROJECT.md constraint). If client abandons and resumes, `resume` route must regenerate a fresh AuthKey — AuthKeys are single-use.
2. **Second bottleneck:** Fan-out in confirm route (upload token + 2 emails) is synchronous. If BPoint times out waiting for a redirect, the client sees a spinner. Consider moving fan-out to a background job in a future phase.

## Anti-Patterns

### Anti-Pattern 1: Trust the Redirect ResponseCode Without Server Verification

**What people do:** Read `?ResponseCode=0` from the query string in the confirm route and immediately mark payment as paid without calling BPoint's retrieve endpoint.

**Why it's wrong:** The redirect URL is visible to and modifiable by the client. A user can manually navigate to `/api/checkout/confirm?ResponseCode=0&ResultKey=fake` and trigger fan-out without paying.

**Do this instead:** Always call `GET /v5/txn/{ResultKey}` server-side using your BPoint credentials and verify `ResponseCode === "0"` in the authenticated response before proceeding.

### Anti-Pattern 2: Reuse a Stripe-style HMAC Verification Pattern for BPoint Webhooks

**What people do:** Assume BPoint sends an `X-BPoint-Signature` header (like Stripe's `stripe-signature`) and implement HMAC verification against it.

**Why it's wrong:** BPoint's webhook does not use HMAC signing. The `constructEvent`-style pattern does not apply. Implementing it means the webhook handler always rejects valid callbacks.

**Do this instead:** Authenticate the BPoint webhook endpoint via a shared secret embedded in the callback URL (e.g., `/api/webhooks/bpoint?secret=<env_var>`) and restrict to BPoint's server IPs if the merchant portal provides them.

### Anti-Pattern 3: Making Client Email/Name Depend on BPoint's Transaction Response

**What people do:** Try to read `clientEmail` and `clientName` from the BPoint transaction response (as Stripe provides `customer_details`).

**Why it's wrong:** BPoint's transaction response does not return customer PII fields by default — only `Crn1` (your session ID), `TxnNumber`, `AmountInCents`. Client details must be fetched from your intake record using `Crn1`.

**Do this instead:** In the confirm route, call `getIntake(txn.Crn1)` to retrieve `clientEmail` and `clientName` for the upload token and emails. This is already how the existing Stripe webhook flow works (it calls `getIntake(sessionId)`).

### Anti-Pattern 4: Keeping `stripeSessionId` Field Alongside `bpointTxnNumber`

**What people do:** Add `bpointTxnNumber` as a new field while leaving `stripeSessionId` in `SessionData` and `IntakeRecord`, resulting in split state.

**Why it's wrong:** Redis session records will have both fields, downstream Zapier transcript email will still emit "Stripe Session: null", and the schema becomes confusing.

**Do this instead:** Rename `stripeSessionId` → `bpointTxnNumber` in both `SessionData` (types/index.ts) and `IntakeRecord` (intake.ts) in a single coordinated change. Update `resend.ts` transcript email label from "Stripe Session" to "BPoint Transaction" in the same PR.

### Anti-Pattern 5: Using a Single Route for Both Confirm Redirect and Webhook

**What people do:** Handle both the browser redirect and the BPoint server callback in the same API route to reduce code.

**Why it's wrong:** The browser redirect is a GET with a `ResultKey` and must return a redirect response. The server webhook is a POST with a JSON body. Combining them means GET must also parse JSON or POST must also redirect browsers — neither is correct.

**Do this instead:** Keep `/api/checkout/confirm` (GET, browser-facing, redirects on completion) and `/api/webhooks/bpoint` (POST, server-facing, returns JSON) as separate routes. Share deduplication logic via a shared `handleConfirmedPayment(txnNumber, sessionId)` function.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| BPoint AuthKey API | Server-to-server POST with Basic Auth (Base64 username:password) | Credentials: `BPOINT_USERNAME`, `BPOINT_PASSWORD`, `BPOINT_MERCHANT_NUMBER` env vars |
| BPoint Result Retrieve | Server-to-server GET with same Basic Auth | Called from confirm route using `ResultKey` from redirect query string |
| BPoint Webhook Callback | Inbound POST to `/api/webhooks/bpoint?secret=<token>` | Authenticated via URL secret, not HMAC. Configure callback URL in BPoint merchant portal. |
| Upstash Redis | Existing `bpoint-txn:{TxnNumber}` dedupe keys (same pattern as `stripe-session:*`) | TTL: 7 days. No change to `session:*` or `intake:*` key structure beyond field rename. |
| Resend | Existing fan-out unchanged | Only change: `stripeSessionId` param renamed to `bpointTxnNumber` in `sendTranscriptEmail`. |
| Zapier | Reads transcript email HTML for field values | Must update "Stripe Session" table row label → "BPoint Transaction" to avoid Zapier field mapping breakage. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `PaymentCard` → `/api/checkout` | POST JSON `{ sessionId, urgency }` → `{ authKey: string }` | Interface identical shape to existing `{ clientSecret }` — only key name changes. |
| `/api/checkout/confirm` → `src/lib/bpoint.ts` | Direct function call | `retrieveBPointResult(resultKey)` returns typed `BPointTxnResult` |
| `/api/checkout/confirm` → `src/lib/kv.ts` | `updateSession()` (existing, unchanged) | Only the field name inside the payload changes |
| `/api/checkout/confirm` → fan-out | Same call sequence as existing Stripe webhook fan-out | `createUploadToken` → `resend.emails.send` (receipt) → `sendTranscriptEmail` |
| `/api/webhooks/bpoint` → `src/lib/bpoint.ts` | Shared `handleConfirmedPayment()` helper | Prevents duplication between confirm route and webhook route |

## Suggested Build Order

Dependencies flow in this sequence — each step unblocks the next:

1. **`src/lib/bpoint.ts`** — Foundation. All other changes depend on this module existing. Implement `createBPointAuthKey()`, `retrieveBPointResult()`, `buildBasicAuth()`, `PRICING` (copy from `stripe.ts`).

2. **Type + schema rename** (`src/types/index.ts`, `src/lib/intake.ts`, `src/lib/kv.ts`) — Rename `stripeSessionId` → `bpointTxnNumber` across `SessionData` and `IntakeRecord`. Do this before touching routes so TypeScript catches all call sites.

3. **`POST /api/checkout`** — Swap Stripe session creation for BPoint AuthKey creation. Return `{ authKey }`. Verify with a test `curl` that BPoint returns a valid AuthKey. Unblocks PaymentCard.

4. **`GET /api/checkout/confirm`** (new route) — The primary confirmation path. Implement `ResultKey` verification, deduplicate via Redis, call existing fan-out. This is the highest-risk new component — test with BPoint's sandbox `ResultKey` before touching the client.

5. **`PaymentCard` component** — Replace Stripe SDK with BPoint iframe. Safe to build in parallel with steps 3–4 once `authKey` shape is agreed. Uses iframe redirect to `/api/checkout/confirm` — confirm route must exist first.

6. **`src/lib/resend.ts` + transcript email** — Rename `stripeSessionId` param → `bpointTxnNumber`. Update Zapier-monitored HTML table label. Low risk — do after types are settled.

7. **`POST /api/webhooks/bpoint`** (new route) — Secondary confirmation. Build last because it shares logic with the confirm route via `handleConfirmedPayment()`. Configure in BPoint merchant portal after sandbox end-to-end test passes.

8. **`GET /api/checkout/resume`** — Remove Stripe session retrieval. Regenerate a fresh BPoint AuthKey from intake data. Build last — it's the email re-entry edge case.

9. **Remove `src/lib/stripe.ts`** and all Stripe npm dependencies (`stripe`, `@stripe/stripe-js`, `@stripe/react-stripe-js`) after end-to-end confirmation in production.

## Sources

- BPoint v5 API documentation (React SPA, partial indexing): https://www.bpoint.com.au/developers/v5/api
- BPoint v5 iframe-fields integration: https://www.bpoint.com.au/developers/v5/api/txn/authkey/payment-method/iframe-fields
- BPoint v5 transaction flow: https://www.bpoint.com.au/developers/v5/api/txn/flow
- BPoint v5 webhooks: https://www.bpoint.com.au/developers/v5/api/webhooks
- BPoint v5 AuthKey (transaction): https://www.bpoint.com.au/developers/v5/api/txn/authkey
- Omnipay BPoint PHP driver (field names verified): https://github.com/wakeless-net/omnipay-bpoint/blob/master/src/Message/Response.php
- Omnipay BPoint digistorm fork: https://github.com/digistorm/omnipay-bpoint
- BPoint redirect response format (ResultKey, ResponseCode): confirmed via BPoint v3 partial views + search snippets
- Spreedly BPoint gateway guide: https://docs.spreedly.com/payment-gateways/bpoint/
- BPoint API user setup: https://support.bpoint.com.au/hc/en-au/articles/43092031505945-How-to-Create-an-API-User

---
*Architecture research for: BPoint payment processor integration (Next.js chatbot)*
*Researched: 2026-04-23*
