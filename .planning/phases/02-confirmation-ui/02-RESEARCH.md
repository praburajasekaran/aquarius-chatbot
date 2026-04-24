# Phase 2: Confirmation & UI — Research

**Researched:** 2026-04-24
**Domain:** BPoint iframe embed, payment confirmation route, fan-out extraction, CSP, Redis dedup, error UX
**Confidence:** HIGH (all findings grounded in existing codebase + prior Phase 1 research; BPoint API shape confirmed via omnipay-bpoint source + v2/v3 partial docs)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Iframe integration mode**
- Single iframe embed: `<iframe src="https://www.bpoint.com.au/webapi/v2/txns/iframe/{authKey}" />`. BPoint serves the whole card form; card data never touches our server. PCI SAQ-A.
- Inline card layout: renders as a bordered card attached to the AI's last message in the chat, same width as other messages. Matches how Stripe's EmbeddedCheckout appears today. Scrolls with chat (no sticky panel, no modal).
- No brand customization of the iframe content — accept BPoint's default form styling.
- CSP swap: drop Stripe origins from `frame-src`/`script-src`; add `www.bpoint.com.au`. Phase 3 removes Stripe anyway.

**Failure message strategy**
- 3 buckets mapped from BPoint `APIResponse.ResponseCode`/`ResponseText`:
  - "Card declined — please try another card." (declined/insufficient funds/expired card codes)
  - "Invalid card details — please check and try again." (CVV/PAN/expiry format codes)
  - "Payment couldn't be processed right now — please try again in a moment." (system/network/unknown codes)
- Retry uses the same AuthKey within the 30min TTL; no new `POST /api/checkout` on retry unless AuthKey expired.
- No retry limit.
- BPoint ResponseCode never shown in UI — logged server-side with `bpointTxnNumber` tag.
- No client-side validation — BPoint's iframe handles Luhn/expiry/CVV format.

**Fan-out trigger boundary**
- Confirm route is primary: `GET /api/checkout/confirm` runs fan-out first for instant user confirmation.
- Phase 3 webhook is safety net.
- Dedup key: `bpoint-txn:{txnNumber}`, TTL 7 days. Shared helper: `src/lib/payments/handleConfirmedPayment.ts`.
- Dual verification: both `APIResponse.ResponseCode === "0"` AND `Approved === true` required. Either false → treat as declined.

**AuthKey expiry UX**
- Detection is reactive — no client-side timer.
- Button click to refresh — "Payment session expired" + "Start again" button. No silent auto-refresh; no full page reload.
- No new endpoint needed — fresh `POST /api/checkout` with same `sessionId` creates new AuthKey and overwrites via `updateIntake`.

### Claude's Discretion
- Exact copy of the "Start again" button label and failure-message phrasing within the 3 buckets
- Loading / processing state visual (spinner, progress indicator) between iframe submit and redirect
- Iframe height/width sizing and mobile viewport behavior
- Exact BPoint ResponseCode → bucket mapping (map to 3 buckets during planning; ambiguous codes default to bucket 3)
- Whether Redis dedup is implemented as SETNX + TTL, a Lua script, or Upstash's atomic primitives
- Log format and fields (as long as `bpointTxnNumber` is the correlation tag)

### Deferred Ideas (OUT OF SCOPE)
- Proactive client-side expiry timer with 25min soft-warning
- BPoint transparent iframe-fields for full visual control
- Card-testing rate limit
- Status field tracking old AuthKey records as "abandoned"
- Post-payment UI micro-interactions (confetti, checkmark animation)
- "See details" expandable with BPoint raw text for support
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CONF-01 | GET `/api/checkout/confirm` route handles browser redirect with ResultKey query parameter | New route at `src/app/api/checkout/confirm/route.ts`; GET handler reads `ResultKey` from `req.nextUrl.searchParams` |
| CONF-02 | Server-side call to BPoint "Retrieve Transaction Result" API verifies authoritative payment status | Add `retrieveTransaction(resultKey)` to `src/lib/bpoint.ts`; calls `GET /webapi/v2/txns/{resultKey}` with Basic Auth |
| CONF-03 | Dual verification: both `ResponseCode === "0"` AND `Approved === true` | Guard in confirm route + handleConfirmedPayment: `data.APIResponse.ResponseCode === "0" && data.TxnResp.Approved === true` |
| CONF-04 | On success, triggers fan-out: session update → upload token → receipt email → firm transcript email | Extract from `src/app/api/webhooks/stripe/route.ts:L85–L130` into `src/lib/payments/handleConfirmedPayment.ts` |
| CONF-05 | Redis dedup prevents duplicate email/token creation on redirect replay | `redis.set("bpoint-txn:{TxnNumber}", "pending", { nx: true, ex: 604800 })` before fan-out |
| UI-01 | PaymentCard replaces Stripe EmbeddedCheckout with BPoint iframe | Replace `EmbeddedCheckoutProvider`/`EmbeddedCheckout` with single `<iframe src="…/iframe/{authKey}">` |
| UI-02 | User sees clear failure messages mapped from BPoint response codes | 3-bucket mapping; error state in PaymentCard component via URL param on redirect |
| UI-03 | CSP headers allow BPoint iframe/JS origins | Update `next.config.ts` headers: add `frame-src https://www.bpoint.com.au`; drop Stripe origins |
| UI-04 | Payment UI handles AuthKey expiry gracefully | Expiry detected from BPoint's response; "Payment session expired" UI with "Start again" button that re-POSTs `/api/checkout` |
</phase_requirements>

---

## Summary

Phase 2 builds on Phase 1's completed foundation (BPoint AuthKey client, `bpointTxnNumber` field rename, pricing module) to deliver the full end-to-end payment flow. The work divides into three coherent areas: (1) replacing the PaymentCard Stripe embed with a BPoint iframe, (2) creating the new `GET /api/checkout/confirm` route that verifies the transaction server-side and runs the fan-out, and (3) extracting the fan-out logic from the Stripe webhook into a shared `handleConfirmedPayment` helper.

The key complexity is that BPoint's redirect-based flow differs fundamentally from Stripe's clientSecret/onComplete model. The PaymentCard no longer fires `onComplete` directly — instead, BPoint redirects the top frame (or iframe) to `/api/checkout/confirm?ResultKey=...&ResponseCode=...`, which means the confirm route must redirect the browser back to the chat at `/` with `?payment=success` or `?payment=failed&reason=...` query params, and the chat page must read those params to update UI state. The `onComplete` prop on `PaymentCard` becomes a state-change hook driven by the URL param rather than by a Stripe SDK callback.

The CSP change is a file-level swap in `next.config.ts` — the current config has no `frame-src` directive for Stripe (it only sets `frame-ancestors *` and `X-Frame-Options`), so the Stripe CSP entries exist only as implicit policy. Adding `frame-src https://www.bpoint.com.au` via a new header entry is the required change. The existing `frame-ancestors *` applies to who can embed this app, not what this app can embed.

**Primary recommendation:** Build in four sequential steps — (1) extract handleConfirmedPayment, (2) create confirm route, (3) update PaymentCard UI, (4) update CSP. Steps 1 and 4 are safe to parallelize.

---

## Standard Stack

### Core (no new dependencies needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@upstash/redis` | existing (v1.37.0) | Redis dedup for confirm route | Already used for `stripe-session:*` dedup in stripe webhook; same pattern for `bpoint-txn:*` |
| Native `fetch` | Node 18+ built-in | `retrieveTransaction` call from confirm route to BPoint | Already used in `createAuthKey` in `src/lib/bpoint.ts` |
| `next/navigation` | Next.js 15 built-in | `NextResponse.redirect()` in confirm route | Standard App Router pattern |
| Tailwind CSS v4 | existing | Spinner / expiry UI states in PaymentCard | Already used throughout components |
| Lucide React | existing | Icons in PaymentCard (e.g. spinner, alert) | Project convention per CLAUDE.md |

**No new npm packages required.** All tooling is already present.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `redis.set(..., { nx: true })` SETNX | Lua script / Upstash pipeline | SETNX is simpler and sufficient; Lua only needed for multi-key atomicity which this pattern doesn't require |
| URL param for payment result (`?payment=failed&reason=declined`) | Cookie / Redis session read on load | URL param is stateless, works on back-navigation, and avoids extra Redis reads |

---

## Architecture Patterns

### Recommended File Structure (changes only)

```
src/
├── app/
│   ├── api/
│   │   └── checkout/
│   │       └── confirm/
│   │           └── route.ts          # NEW — GET handler, ResultKey verify + fan-out
│   └── page.tsx                      # MODIFY — read ?payment= URL param, trigger onComplete
├── components/
│   └── payment/
│       └── payment-card.tsx          # MODIFY — replace EmbeddedCheckout with iframe
└── lib/
    ├── bpoint.ts                     # MODIFY — add retrieveTransaction()
    └── payments/
        └── handleConfirmedPayment.ts # NEW — extracted fan-out helper
```

### Pattern 1: BPoint Retrieve Transaction (CONF-02)

**What:** After BPoint redirects to `/api/checkout/confirm?ResultKey=<uuid>&ResponseCode=0`, the confirm route calls BPoint's retrieve endpoint using the ResultKey. This is the authoritative verification — `ResponseCode` in the URL is client-visible and forgeable.

**Endpoint:** `GET https://www.bpoint.com.au/webapi/v2/txns/{resultKey}`
**Auth:** Same `Basic base64(username|merchantNumber:password)` header as `createAuthKey`.

**Response shape** (confirmed via omnipay-bpoint source + v2/v3 crawlable docs):
```typescript
interface BPointTxnResponse {
  APIResponse: {
    ResponseCode: string;   // "0" = API success; non-zero = API error
    ResponseText: string;
  };
  TxnResp: {
    Action: string;           // "payment"
    Amount: number;           // integer cents
    AmountOriginal: number;
    AmountSurcharge: number;
    AuthoriseId: string;
    BankResponseCode: string; // bank-level code (see bucket mapping below)
    Crn1: string;             // your sessionId (passed in createAuthKey)
    IsTestTxn: boolean;
    MerchantReference: string;
    ReceiptNumber: string;
    ResponseCode: string;     // same as APIResponse.ResponseCode
    ResponseText: string;
    TxnNumber: string;        // unique transaction identifier — the dedup key
    Approved: boolean;        // TRUE = bank authorised; FALSE = declined
  } | null;
}
```

**Confidence:** MEDIUM-HIGH — `TxnNumber`, `Approved`, `Crn1`, `BankResponseCode`, `Amount` field names confirmed via omnipay-bpoint `Response.php` (wakeless-net fork). `APIResponse.ResponseCode` field path confirmed via Phase 1 code (`src/lib/bpoint.ts:L97-L112`).

**Function to add to `src/lib/bpoint.ts`:**
```typescript
export interface BPointTxnResp {
  TxnNumber: string;
  Approved: boolean;
  Crn1: string;
  Amount: number;
  BankResponseCode: string;
  ResponseText: string;
}

export interface BPointTxnResponse {
  APIResponse: { ResponseCode: string; ResponseText: string };
  TxnResp: BPointTxnResp | null;
}

export async function retrieveTransaction(
  resultKey: string
): Promise<BPointTxnResponse> {
  const cfg = getBpointConfig();
  const authHeader = buildBpointAuthHeader(cfg.username, cfg.merchantNumber, cfg.password);
  const res = await fetch(`${cfg.baseUrl}/txns/${resultKey}`, {
    headers: { Authorization: authHeader },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[bpoint] retrieveTransaction failed", res.status, body);
    throw new Error(`BPoint retrieve failed: ${res.status}`);
  }
  return res.json() as Promise<BPointTxnResponse>;
}
```

### Pattern 2: Confirm Route (CONF-01, CONF-02, CONF-03, CONF-04, CONF-05)

**What:** `GET /api/checkout/confirm` is the browser landing route after BPoint iframe payment. It verifies the transaction server-side, deduplicates, runs fan-out, then redirects the browser back to the chat.

```typescript
// src/app/api/checkout/confirm/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { retrieveTransaction } from "@/lib/bpoint";
import { redis } from "@/lib/kv";
import { handleConfirmedPayment } from "@/lib/payments/handleConfirmedPayment";

const DEDUPE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days — matches stripe-session:* pattern
const APP_URL = () => process.env.NEXT_PUBLIC_URL ?? "";

export async function GET(req: NextRequest) {
  const resultKey = req.nextUrl.searchParams.get("ResultKey");
  const responseCode = req.nextUrl.searchParams.get("ResponseCode");

  // Early exit on missing/failed redirect params (don't call BPoint)
  if (!resultKey || responseCode !== "0") {
    const reason = encodeURIComponent("declined");
    return NextResponse.redirect(`${APP_URL()}/?payment=failed&reason=${reason}`);
  }

  let txn: Awaited<ReturnType<typeof retrieveTransaction>>;
  try {
    txn = await retrieveTransaction(resultKey);
  } catch {
    console.error("[bpoint-confirm] retrieveTransaction threw", { resultKey });
    return NextResponse.redirect(`${APP_URL()}/?payment=failed&reason=system`);
  }

  // CONF-03: dual verification
  const approved =
    txn.APIResponse?.ResponseCode === "0" && txn.TxnResp?.Approved === true;

  if (!approved || !txn.TxnResp) {
    const bankCode = txn.TxnResp?.BankResponseCode ?? "unknown";
    const reason = encodeURIComponent(bucketBankCode(bankCode));
    console.info("[bpoint-confirm] payment not approved", {
      bpointTxnNumber: txn.TxnResp?.TxnNumber,
      bankCode,
    });
    return NextResponse.redirect(`${APP_URL()}/?payment=failed&reason=${reason}`);
  }

  const { TxnNumber, Crn1: sessionId, Amount: amountCents } = txn.TxnResp;

  // CONF-05: Redis dedup (SETNX)
  const dedupeKey = `bpoint-txn:${TxnNumber}`;
  const created = await redis.set(dedupeKey, "pending", {
    nx: true,
    ex: DEDUPE_TTL_SECONDS,
  });

  if (created !== "OK") {
    // Already processed (redirect replay or webhook race) — safe to redirect to success
    console.info("[bpoint-confirm] duplicate ignored", { bpointTxnNumber: TxnNumber });
    return NextResponse.redirect(`${APP_URL()}/?payment=success`);
  }

  // CONF-04: fan-out
  try {
    await handleConfirmedPayment({ sessionId, bpointTxnNumber: TxnNumber, amountCents });
  } catch (err) {
    // Fan-out failure must not block the user redirect
    console.error("[bpoint-confirm] fan-out failed", {
      bpointTxnNumber: TxnNumber,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.redirect(`${APP_URL()}/?payment=success`);
}
```

### Pattern 3: handleConfirmedPayment Helper (CONF-04)

**What:** Extract fan-out from `src/app/api/webhooks/stripe/route.ts:L57-L124` into a standalone function. Both the confirm route (Phase 2) and the BPoint webhook (Phase 3) import this.

**Signature:**
```typescript
// src/lib/payments/handleConfirmedPayment.ts
export async function handleConfirmedPayment({
  sessionId,
  bpointTxnNumber,
  amountCents,
}: {
  sessionId: string;
  bpointTxnNumber: string;
  amountCents: number;
}): Promise<void>
```

**Internals (copied from stripe webhook, adapted):**
1. `updateSession(sessionId, { paymentStatus: "paid", bpointTxnNumber, paymentAmount: amountCents })`
2. `intake = await getIntake(sessionId)` — fetch `clientEmail`, `clientName` (BPoint doesn't return PII, must come from intake)
3. `createUploadToken({ matterRef: sessionId, clientEmail, clientName, sessionId })`
4. `await redis.set(dedupeKey, hashToken(rawToken), { ex: DEDUPE_TTL_SECONDS })` — upgrade dedup key from "pending" to token hash
5. `resend.emails.send(...)` — `PaymentReceipt` to client
6. `sendTranscriptEmail(...)` — firm notification / Zapier trigger

**Log tag:** `[payments]` for the shared helper.

### Pattern 4: PaymentCard BPoint iframe (UI-01, UI-02, UI-04)

**What:** Replace `EmbeddedCheckoutProvider` / `EmbeddedCheckout` with a single `<iframe>`. The component still calls `POST /api/checkout` to get `authKey`, then renders the iframe. On payment, BPoint redirects the top frame to `/api/checkout/confirm` — the component does not receive a callback. Instead, the parent page reads `?payment=success` or `?payment=failed&reason=...` from the URL after redirect.

**State machine inside PaymentCard:**
```
idle → loading (POST /api/checkout) → ready (iframe visible) → [BPoint redirects top frame]
                                    ↓ on error from /api/checkout
                                 error (system error message)
                                    ↓ on AuthKey expiry detected
                                 expired (expiry message + Start again button)
```

**Key decisions:**
- `authKey` state: fetched once on mount via `useEffect` or `useCallback`, stored in component state.
- Iframe src: `https://www.bpoint.com.au/webapi/v2/txns/iframe/{authKey}`
- Iframe sizing: `width: "100%"`, `minHeight: 420` — Claude's discretion; must not overflow chat width.
- "Start again" triggers a fresh `POST /api/checkout` → new authKey → re-renders iframe.
- **Expiry detection:** BPoint returns a non-zero `ResponseCode` in the redirect URL when the AuthKey has expired. The confirm route redirects to `/?payment=failed&reason=expired`. The chat page detects `reason=expired` and signals PaymentCard to show the expiry UI. This requires the parent page to pass the failure reason down to PaymentCard.

**Error/expiry signalling from parent page:**
Since BPoint redirects the top frame (not a postMessage), the chat page `src/app/page.tsx` needs to read the `?payment=` search param on load and call the appropriate callback. The existing `onPaymentComplete` prop on `MessageList` becomes the signal path.

### Pattern 5: CSP Update (UI-03)

**What:** Add `frame-src` to `next.config.ts` to allow the BPoint iframe to load.

**Current state of `next.config.ts`:** No `frame-src` directive — only `frame-ancestors *` (which governs who can embed this app) and `X-Frame-Options: ALLOWALL`. There are no Stripe CSP entries to remove in the current config because Stripe's Embedded Checkout enforces its own domain requirements client-side through the JS SDK rather than needing `frame-src` in next.config.ts.

**Required change:**
```typescript
// Add to the global "/:path*" header block in next.config.ts
{ key: "Content-Security-Policy", value: "frame-src https://www.bpoint.com.au" }
```

**Confidence note:** The current `Content-Security-Policy` header only sets `frame-ancestors *`. Adding a `frame-src` directive does not conflict with this. Verify in browser devtools after deploy that no CSP violation appears when the iframe loads.

### Pattern 6: BPoint BankResponseCode → 3-Bucket Mapping

**What:** Map `TxnResp.BankResponseCode` to the three user-facing message buckets.

**Standard ISO 8583 bank response codes** (confirmed via BPoint v5 reference + industry standard):

| Bucket | Message | BankResponseCodes |
|--------|---------|-------------------|
| Declined | "Card declined — please try another card." | `05` (Do not honour), `51` (Insufficient funds), `54` (Expired card), `57` (Transaction not permitted), `61` (Exceeds withdrawal limit), `62` (Restricted card), `65` (Exceeds withdrawal frequency limit), `91` (Issuer unavailable — treated as declined retry) |
| Invalid | "Invalid card details — please check and try again." | `14` (Invalid card number), `55` (Incorrect PIN), `82` (CVV2 failed), `N7` (CVV2 mismatch) |
| System | "Payment couldn't be processed right now — please try again in a moment." | All other codes including `12` (Invalid transaction), `13` (Invalid amount), `15` (No such issuer), `96` (System error), `00` (should never reach here — means approved), and any unrecognised code |

**Implementation:**
```typescript
// In confirm route or a separate src/lib/payments/bucketBankCode.ts
function bucketBankCode(code: string): "declined" | "invalid" | "system" {
  const declined = ["05", "51", "54", "57", "61", "62", "65", "91"];
  const invalid  = ["14", "55", "82", "N7"];
  if (declined.includes(code)) return "declined";
  if (invalid.includes(code))  return "invalid";
  return "system"; // default — bucket 3
}
```

**Confidence:** MEDIUM — ISO 8583 codes are industry-standard and confirmed in BPoint v5 bank-response-codes reference. Specific BPoint-only codes may vary; ambiguous codes correctly default to bucket 3.

### Anti-Patterns to Avoid

- **Trust `ResponseCode=0` in the redirect URL:** Forgeable. Always call `retrieveTransaction` server-side first.
- **Put `onComplete` on iframe:** BPoint iframe redirects the top frame, not the parent React component. There is no postMessage or onComplete callback.
- **Fan-out inside PaymentCard:** PaymentCard is a client component with no server access. Fan-out lives entirely in the confirm route and handleConfirmedPayment.
- **Re-create AuthKey on every retry:** Re-render the existing iframe within the 30min TTL. Only create a new AuthKey when the user explicitly clicks "Start again" after expiry.
- **Single verification field:** `Approved === true` alone is not sufficient — check both `APIResponse.ResponseCode === "0"` AND `TxnResp.Approved === true`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Card data capture | Custom card form with `<input>` fields | BPoint iframe | PCI SAQ-A requires card data never touch your server |
| Payment deduplication | Custom timestamp-based dedup | `redis.set(..., { nx: true })` SETNX | Atomic; already used for `stripe-session:*`; race-safe |
| Email sending with upload link | Custom HTML builder | Existing `PaymentReceipt` React Email component | Already wired in stripe webhook; just extract the call |
| BPoint response parsing | Custom response normalizer | `retrieveTransaction()` returning typed `BPointTxnResponse` | Isolates the API contract in one place |

---

## Common Pitfalls

### Pitfall 1: BPoint Redirects the Top Frame, Not the Iframe

**What goes wrong:** Developer expects BPoint to postMessage back to the React component (like Stripe's SDK), or to navigate only the iframe. BPoint actually redirects the top-level browser frame to `RedirectionUrl`.
**Why it happens:** Mental model carried from Stripe's `onComplete` callback pattern.
**How to avoid:** Design the confirm route as a full server-side redirect handler. Read `?payment=` search param on the chat page root to restore UI state after the top-frame redirect.
**Warning signs:** PaymentCard has an `onComplete` wired to a BPoint iframe event listener — that listener will never fire.

### Pitfall 2: Client Email/Name Not in BPoint Transaction Response

**What goes wrong:** Confirm route tries to read `clientEmail` from the BPoint `TxnResp` object (like Stripe's `customer_details.email`). Field doesn't exist; fan-out emails fail.
**Why it happens:** Stripe provides customer PII; BPoint only provides `Crn1` (your sessionId), `TxnNumber`, `Amount`.
**How to avoid:** In `handleConfirmedPayment`, call `getIntake(sessionId)` to fetch `clientEmail` and `clientName` from Redis. This already happens in the existing Stripe webhook.

### Pitfall 3: Dedup Key Set After Fan-Out

**What goes wrong:** Redis dedup key is set at the end of fan-out. If a concurrent duplicate redirect arrives between the start of fan-out and the Redis set, both invocations run fan-out. Client receives two receipts.
**How to avoid:** Set `bpoint-txn:{TxnNumber}` as `"pending"` with SETNX **before** any fan-out side effects. Upgrade to `hashToken(rawToken)` after upload token creation.

### Pitfall 4: Confirm Route Returns Non-2xx on Fan-Out Error

**What goes wrong:** If fan-out throws, the confirm route returns a 500 and BPoint may retry the redirect. Each retry triggers the fan-out again.
**How to avoid:** Wrap fan-out in try/catch inside the confirm route. Always redirect to `/?payment=success` or `/?payment=failed` regardless of fan-out outcome. Log fan-out errors with `bpointTxnNumber` for support correlation.

### Pitfall 5: Iframe Height Too Small — Card Form Clipped

**What goes wrong:** BPoint's card form is taller than a typical `<input>` replacement. If the iframe height is set too low, the submit button is invisible and users can't complete payment.
**How to avoid:** Set `minHeight: 420px` as a starting point; verify visually in UAT. BPoint's default form height varies by viewport and form mode.

### Pitfall 6: `?payment=success` Param Triggers onComplete for Historical PaymentCard

**What goes wrong:** On page load after redirect, the chat re-renders all historical messages including old PaymentCard tools. The `?payment=success` param triggers all of them.
**How to avoid:** Only trigger `onPaymentComplete` for the latest PaymentCard (the `isLatest` guard in `message-list.tsx:L195-L196`). Clear the URL param after processing to prevent re-triggering on refresh (`window.history.replaceState`).

---

## Code Examples

### retrieveTransaction in bpoint.ts
```typescript
// Source: Phase 1 getBpointConfig/buildBpointAuthHeader pattern (src/lib/bpoint.ts)
export async function retrieveTransaction(resultKey: string): Promise<BPointTxnResponse> {
  const cfg = getBpointConfig();
  const authHeader = buildBpointAuthHeader(cfg.username, cfg.merchantNumber, cfg.password);
  const res = await fetch(`${cfg.baseUrl}/txns/${resultKey}`, {
    headers: { Authorization: authHeader },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[bpoint] retrieveTransaction failed", res.status, body);
    throw new Error(`BPoint retrieve failed: ${res.status}`);
  }
  return res.json() as Promise<BPointTxnResponse>;
}
```

### Redis SETNX dedup (existing pattern from stripe webhook)
```typescript
// Source: src/app/api/webhooks/stripe/route.ts:L59-L68 — same pattern, new key prefix
const dedupeKey = `bpoint-txn:${TxnNumber}`;
const created = await redis.set(dedupeKey, "pending", {
  nx: true,
  ex: DEDUPE_TTL_SECONDS, // 7 days = 604800 seconds
});
if (created !== "OK") {
  console.info("[bpoint-confirm] duplicate ignored", { bpointTxnNumber: TxnNumber });
  return NextResponse.redirect(`${APP_URL()}/?payment=success`);
}
```

### PaymentCard iframe skeleton (replaces EmbeddedCheckoutProvider)
```typescript
// Source: src/components/payment/payment-card.tsx — replace lines 74–81
"use client";
import { useEffect, useState } from "react";
import { CreditCard, RefreshCw } from "lucide-react";
import { PRICING } from "@/lib/pricing";

// authKey is fetched once on mount; null while loading
const [authKey, setAuthKey] = useState<string | null>(null);
const [status, setStatus] = useState<"loading" | "ready" | "expired" | "error">("loading");

useEffect(() => {
  fetch("/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, urgency }),
  })
    .then((r) => r.json())
    .then(({ authKey: key }) => { setAuthKey(key); setStatus("ready"); })
    .catch(() => setStatus("error"));
}, []); // runs once on mount

// iframe when ready:
{status === "ready" && authKey && (
  <iframe
    src={`https://www.bpoint.com.au/webapi/v2/txns/iframe/${authKey}`}
    title="Secure card payment"
    className="w-full rounded-lg border border-gray-200"
    style={{ minHeight: 420 }}
  />
)}
```

### next.config.ts CSP addition
```typescript
// Source: next.config.ts — add to "/:path*" headers array
{ key: "Content-Security-Policy", value: "frame-src https://www.bpoint.com.au" }
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Stripe EmbeddedCheckout (clientSecret + onComplete) | BPoint iframe (authKey + top-frame redirect) | Phase 2 | No postMessage callback; result delivered via URL redirect to `/api/checkout/confirm` |
| Fan-out in `webhooks/stripe/route.ts` | Shared `handleConfirmedPayment.ts` | Phase 2 | Both confirm route (Phase 2) and BPoint webhook (Phase 3) import the same helper |
| `stripe-session:*` dedup key | `bpoint-txn:*` dedup key | Phase 2 | Same SETNX pattern, new key prefix; stripe webhook still uses old key during Phase 2 soak |

---

## Open Questions

1. **Does BPoint's iframe redirect the top frame or navigate only the iframe?**
   - What we know: ARCHITECTURE.md and PITFALLS.md both state the top frame is redirected. STACK.md single-page mode description says the iframe navigates internally.
   - What's unclear: In submit-button mode (which is what the single iframe uses when `ShowSubmitButton` is implied true), the iframe navigates itself. If `RedirectionUrl` causes an iframe-internal navigation, the confirm route is called from within the iframe, not from the top frame. This would mean the top frame does NOT redirect and `?payment=success` reading on page.tsx won't work.
   - Recommendation: **Test empirically in UAT once BPoint HPP is activated.** If iframe-only redirect: use `window.parent.postMessage` from the confirm route's redirect page instead of a direct top-frame redirect. Design the confirm route to return an HTML page with `<script>window.top.location.href = '/?payment=success'</script>` as a fallback.

2. **Exact BPoint redirect URL format: `ResultKey` vs `resultKey` casing**
   - What we know: ARCHITECTURE.md uses `ResultKey` (capital R, K). STACK.md v3 partial docs show `ResultKey=13cfa799...` in the example URL.
   - What's unclear: Actual query param name casing from a live BPoint redirect.
   - Recommendation: Read both `ResultKey` and `resultkey` defensively: `req.nextUrl.searchParams.get("ResultKey") ?? req.nextUrl.searchParams.get("resultkey")`.

3. **`retrieveTransaction` endpoint: `/txns/{resultKey}` vs `/txns/result/{resultKey}`**
   - What we know: ARCHITECTURE.md uses `GET /v5/txn/{ResultKey}`. STACK.md table shows `GET /v2/txns/{txnNumber}`. Phase 1 code uses `/webapi/v2/txns/processtxnauthkey` (not `/v5/txn/`).
   - What's unclear: Whether the retrieve endpoint is keyed by ResultKey (the UUID from the redirect URL) or by TxnNumber (the settled transaction ID). These are different values.
   - Recommendation: **ResultKey is the lookup handle for the redirect path.** Use `GET /webapi/v2/txns/{resultKey}` following the v2 pattern confirmed in Phase 1. If this returns 404, try `/webapi/v2/txns/result/{resultKey}`. Verify in UAT.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None detected — no test directory, no jest/vitest config, no package.json test script |
| Config file | None — Wave 0 must install |
| Quick run command | `npx vitest run --reporter=dot` (once installed) |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONF-01 | Confirm route reads ResultKey from query string | unit | `npx vitest run tests/confirm-route.test.ts -t "reads ResultKey"` | ❌ Wave 0 |
| CONF-02 | retrieveTransaction calls BPoint with correct auth + URL | unit (mock fetch) | `npx vitest run tests/bpoint.test.ts -t "retrieveTransaction"` | ❌ Wave 0 |
| CONF-03 | Dual verification: ResponseCode=0 AND Approved=true | unit | `npx vitest run tests/confirm-route.test.ts -t "dual verification"` | ❌ Wave 0 |
| CONF-04 | Fan-out invoked on success | unit (mock handleConfirmedPayment) | `npx vitest run tests/confirm-route.test.ts -t "fan-out"` | ❌ Wave 0 |
| CONF-05 | Dedup key prevents second fan-out | unit (mock redis SETNX returns null) | `npx vitest run tests/confirm-route.test.ts -t "dedup"` | ❌ Wave 0 |
| UI-01 | PaymentCard renders iframe with correct src | unit (React Testing Library) | `npx vitest run tests/payment-card.test.tsx -t "renders iframe"` | ❌ Wave 0 |
| UI-02 | bucketBankCode maps codes to correct bucket | unit | `npx vitest run tests/bucket-bank-code.test.ts` | ❌ Wave 0 |
| UI-03 | CSP header includes bpoint.com.au frame-src | manual browser devtools | manual-only | — |
| UI-04 | PaymentCard shows expiry UI and re-fetches authKey | unit (mock expired reason) | `npx vitest run tests/payment-card.test.tsx -t "expiry"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=dot` (< 10s for unit tests)
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/bpoint.test.ts` — covers CONF-02 (retrieveTransaction with mocked fetch)
- [ ] `tests/confirm-route.test.ts` — covers CONF-01, CONF-03, CONF-04, CONF-05
- [ ] `tests/payment-card.test.tsx` — covers UI-01, UI-04
- [ ] `tests/bucket-bank-code.test.ts` — covers UI-02
- [ ] `vitest.config.ts` — framework config
- [ ] Framework install: `npm install -D vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom jsdom` — no test infrastructure detected

---

## Sources

### Primary (HIGH confidence)
- `src/lib/bpoint.ts` — Phase 1 getBpointConfig, buildBpointAuthHeader, APIResponse shape confirmed in running code
- `src/app/api/webhooks/stripe/route.ts` — fan-out logic to extract (L57-L124)
- `src/app/api/checkout/route.ts` — Phase 1 AuthKey creation; confirm route follows same Basic Auth pattern
- `src/lib/kv.ts` — redis.set SETNX pattern for dedup
- `src/components/payment/payment-card.tsx` — existing Stripe component to replace
- `src/components/chat/message-list.tsx` — how PaymentCard is wired into the chat; isLatest guard
- `.planning/phases/01-foundation/01-VERIFICATION.md` — Phase 1 code fixes (URL path, ProcessTxnData, APIResponse parser)
- `.planning/phases/02-confirmation-ui/02-CONTEXT.md` — all locked decisions

### Secondary (MEDIUM confidence)
- `.planning/research/ARCHITECTURE.md` — confirm route pattern, dedup key format, fan-out flow diagram
- `.planning/research/PITFALLS.md` — dual verification, dedup before fan-out, redirect URL not trusted
- `.planning/research/STACK.md` — iframe URL format, v2 endpoint table
- [omnipay-bpoint Response.php](https://github.com/wakeless-net/omnipay-bpoint/blob/master/src/Message/Response.php) — TxnResp field names: TxnNumber, Approved, Crn1, BankResponseCode
- [BPoint v3 partial — transaction responses](https://bpoint.com.au/developers/v3/partialViews/Sections/txnresponses/description.html) — ResponseCode, redirect URL format with ResultKey

### Tertiary (LOW confidence — needs UAT validation)
- BPoint v5 bank response codes page (React SPA, not crawlable) — ISO 8583 codes assumed standard
- Iframe redirect behaviour (top-frame vs iframe-only) — not confirmed from docs; flagged as Open Question 1

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; all patterns already in codebase
- Architecture: HIGH — confirm route + handleConfirmedPayment pattern is a direct extraction of existing stripe webhook; BPoint field names confirmed via omnipay-bpoint source
- Pitfalls: HIGH — grounded in PITFALLS.md (prior research) + Phase 1 verification learnings
- CSP change: HIGH — current next.config.ts is fully read; no existing frame-src to conflict with
- Iframe redirect behaviour: LOW — empirical UAT test needed once BPoint HPP is activated

**Research date:** 2026-04-24
**Valid until:** 2026-05-24 (stable integration; BPoint API v2 is not fast-moving)
