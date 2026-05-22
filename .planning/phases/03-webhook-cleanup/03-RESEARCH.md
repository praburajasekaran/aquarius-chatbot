# Phase 3: Webhook & Cleanup - Research

**Researched:** 2026-04-24
**Domain:** BPoint v2 server-to-server webhook handler + Stripe package removal
**Confidence:** HIGH (existing codebase fully read, BPoint API v2 docs partially accessible; one key finding confirmed — WebHookUrl field name; single unknown remains: exact webhook payload body schema)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Webhook authentication:** Trust-via-retrieveTransaction only. No shared secret, no IP allowlist, no HMAC signature check on the inbound POST. Authentication is the server-side call to BPoint Retrieve Transaction API.
- **Callback input contract:** `ResultKey` from the request URL query string (same as browser redirect). Parse via `new URL(req.url).searchParams.get("ResultKey")`; defensively also check `"resultkey"` casing. Do NOT parse the request body — v5 callback body schema unknown.
- **Early-exit on missing ResultKey:** Log and return 200 — webhook MUST always return 200.
- **Shared fan-out + dedup:** `handleConfirmedPayment` is the shared helper. Dedup key: `bpoint-txn:{TxnNumber}` via Redis SETNX + 7d TTL — identical to confirm route. Dual verification: `APIResponse.ResponseCode === 0` numeric AND `TxnResp.Approved === true` before fan-out.
- **Webhook always returns 200:** Regardless of fan-out outcome (WEBH-04). Prevents BPoint retry storms.
- **Route path:** `/api/webhooks/bpoint` (POST).
- **Webhook URL field:** `WebHookUrl` in `ProcessTxnData` within `createAuthKey`. Points to `${NEXT_PUBLIC_URL}/api/webhooks/bpoint`. No new env vars.
- **checkout/resume route:** Port to BPoint — do not delete. Reuse existing AuthKey if within 30-min TTL; create fresh AuthKey if expired.
- **Redis prefix rename:** `stripe-session:` → `bpoint-txn:` in `src/scripts/revoke-upload-token.ts`. No migration script.
- **Env var scrubbing:** Remove `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` from `.env.example` and `INTEGRATIONS.md`. Do NOT touch `.env.local`.
- **Cleanup sequencing:** Webhook first → resume port → delete Stripe files → rename Redis prefix → scrub env vars → uninstall packages → verify build + lint.
- **Observability:** Structured `console.error` with `[bpoint-webhook]` prefix. Log fields: `tag`, `phase`, `bpointTxnNumber`, `sessionId`, `err: { message, stack }`, `timestamp`. No new alerting surface.
- **Race logging:** Both webhook-wins and webhook-loses are `console.info`. Neither is an alert condition.

### Claude's Discretion

- Exact naming of the BPoint notification URL field — researcher confirms (candidates: `ServerNotificationUrl`, `NotificationUrl`, `CallbackUrl`). **CONFIRMED: `WebHookUrl`** (see Standard Stack section).
- Whether the webhook route uses `POST` only or also accepts `GET`. **CONFIRMED: POST only** (BPoint v2 sends a server POST; GET is the browser redirect which goes to the confirm route).
- Exact structure of the `phase` tag in failure logs (free-form string acceptable).
- Whether webhook handler is a single `POST` export or splits into helper + handler — follow Phase 2's shape (single handler function).
- Zod schema for the `retrieveTransaction` response — reuse `BPointTxnResp` type from Phase 2, no new schema.
- Whether to capture a raw body snapshot on first prod deploy — nice-to-have; Claude can add a `req.text()` info-level log that is gated on a non-prod flag.

### Deferred Ideas (OUT OF SCOPE)

- Raw-body snapshot capture on first prod deploy (log `req.text()` for N days).
- Alert email to firm ops on fan-out failure.
- Redis failure-list for post-hoc inspection (`bpoint-webhook:failures`).
- Inline retry with backoff for fan-out steps.
- Warn when webhook consistently wins the SETNX race (signals confirm-redirect regression).
- One-time Redis SCAN migration of `stripe-session:*` → `bpoint-txn:*`.
- Separate webhook URL per env via `BPOINT_WEBHOOK_URL` override.
- Search Transactions API fallback (RESL-01), email-based payment resume (RESL-02), refund endpoint (REFD-01..02), BPoint token storage (TOKN-01) — all v2.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| WEBH-01 | POST `/api/webhooks/bpoint` handler receives BPoint server-to-server callback | Confirmed: BPoint v2 `WebHookUrl` field in `ProcessTxnData` sends a server POST to the registered URL. Route file goes in `src/app/api/webhooks/bpoint/route.ts`. |
| WEBH-02 | Webhook calls Retrieve Transaction Result API — does NOT trust callback payload alone | Existing `retrieveTransaction` in `src/lib/bpoint.ts` is reused as-is. `ResultKey` comes from query string — same pattern as confirm route. |
| WEBH-03 | Shared `handleConfirmedPayment()` helper used by both redirect confirm route and webhook | `src/lib/payments/handleConfirmedPayment.ts` exists and is imported verbatim — identical args: `{ sessionId, bpointTxnNumber, amountCents }`. |
| WEBH-04 | Webhook always returns 200 (even on internal errors) to prevent retry storms | Pattern established in `src/app/api/webhooks/stripe/route.ts`. Webhook handler wraps fan-out in try/catch and returns `NextResponse.json({ received: true })` always. |
| CLEAN-01 | Stripe npm packages removed from dependencies | `stripe`, `@stripe/stripe-js`, `@stripe/react-stripe-js` in `package.json` dependencies — confirmed via direct file read. `npm uninstall` removes all three; `npm run build` + `npm run lint` verify. |
| CLEAN-02 | Stripe code deleted (`src/lib/stripe.ts`, `src/app/api/webhooks/stripe/route.ts`, Stripe env vars) | Both files confirmed read. `src/app/api/checkout/resume/route.ts` imports `getStripe()` + `createCheckoutSession` — must be ported first. `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in `.env.example`. |
| CLEAN-03 | Stripe environment variables removed from documentation and deployment config | Three Stripe vars in `.env.example` lines 17-19 (with DEPRECATED comment). Also referenced in `INTEGRATIONS.md` under Payment Processing and Required env vars sections. |
</phase_requirements>

---

## Summary

Phase 3 is a well-bounded, low-risk phase with two distinct deliverables: (1) a new webhook route that is structurally identical to the Phase 2 confirm route minus browser redirects, and (2) a sequenced Stripe removal that eliminates all Stripe npm packages, source files, env vars, and Redis key prefixes.

The most critical finding from codebase research is that `src/app/api/checkout/resume/route.ts` still imports and calls `getStripe()` and `createCheckoutSession` from `@/lib/stripe` — this is the last Stripe caller outside the files scheduled for deletion. The resume route must be ported to BPoint AuthKey reuse/refresh logic before `src/lib/stripe.ts` can be safely deleted. This enforces the sequencing: webhook → resume port → Stripe deletion.

The BPoint notification URL field name is confirmed as **`WebHookUrl`** (from BPoint v2 API documentation). It is registered per-AuthKey inside `ProcessTxnData`, not in the merchant portal — exactly as the CONTEXT.md anticipated. This resolves the single blocking question. The fallback (merchant portal registration) is not needed.

The webhook body schema from BPoint remains unverified from public documentation. The CONTEXT.md decision to read `ResultKey` from the URL query string (not the body) is the correct strategy: it uses the same documented contract as the browser redirect, avoids coupling to an unknown body schema, and is fully consistent with the existing confirm route's parsing logic.

**Primary recommendation:** Build the webhook handler as a carbon copy of `GET /api/checkout/confirm` with two changes — parse from URL params without the early-exit `ResponseCode` check (no user redirect target), and always return `NextResponse.json({ received: true })` with status 200.

---

## Standard Stack

### Core (unchanged from Phase 2 — all already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | 16.2.3 | App Router route handler (`export async function POST`) | Already in project; `route.ts` convention |
| `@upstash/redis` | 1.37.0 | Redis SETNX dedup + `bpoint-txn:` key reads in revoke script | Already in project; same dedup TTL pattern |
| `vitest` | 2.1.9 | Test runner for webhook unit tests | Already installed from Phase 2 Wave 0 |

### Packages to Remove (CLEAN-01)

| Package | Current Version | Removal Command |
|---------|----------------|-----------------|
| `stripe` | 22.0.1 | `npm uninstall stripe` |
| `@stripe/stripe-js` | 9.1.0 | `npm uninstall @stripe/stripe-js` |
| `@stripe/react-stripe-js` | 6.1.0 | `npm uninstall @stripe/react-stripe-js` |

**Post-removal verification:**
```bash
npm run build   # must complete without errors
npm run lint    # must return zero ESLint violations
npm test        # 40/40 tests must remain green
```

---

## Architecture Patterns

### Recommended Project Structure (Phase 3 additions)

```
src/
├── app/
│   └── api/
│       └── webhooks/
│           ├── bpoint/
│           │   └── route.ts      # NEW: POST handler — WEBH-01..04
│           └── stripe/
│               └── route.ts      # DELETE in final cleanup wave
├── scripts/
│   └── revoke-upload-token.ts    # MODIFY: stripe-session: → bpoint-txn:
└── app/api/checkout/
    └── resume/
        └── route.ts              # MODIFY: port Stripe session reuse → BPoint AuthKey reuse
```

### Pattern 1: Webhook Handler as Confirm-Route Mirror

**What:** The webhook route is structurally identical to `GET /api/checkout/confirm` with three differences: it is a POST export, it does not do the `ResponseCode !== "0"` early-exit (no user to redirect on the server path), and it returns `NextResponse.json({ received: true })` with HTTP 200 unconditionally instead of browser redirects.

**When to use:** Always for BPoint server-to-server callbacks.

**Key structural difference from confirm route:**

```typescript
// Source: src/app/api/checkout/confirm/route.ts (Phase 2 — existing)
// Confirm route: early-exits on URL ResponseCode != "0"
if (!resultKey || urlResponseCode !== "0") {
  return failedRedirect("declined");  // browser redirect
}

// Webhook route: no ResponseCode check (body-only — BPoint sends ResultKey in URL)
// Also no early-exit redirect — just 200 + log
if (!resultKey) {
  console.info("[bpoint-webhook] no ResultKey — ignoring", { url: req.url });
  return NextResponse.json({ received: true });  // always 200
}
```

**Full webhook handler structure:**

```typescript
// src/app/api/webhooks/bpoint/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { retrieveTransaction } from "@/lib/bpoint";
import { redis } from "@/lib/kv";
import { handleConfirmedPayment } from "@/lib/payments/handleConfirmedPayment";

const DEDUPE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7d — matches confirm route

export async function POST(req: NextRequest): Promise<NextResponse> {
  const params = new URL(req.url).searchParams;
  const resultKey = params.get("ResultKey") ?? params.get("resultkey");

  if (!resultKey) {
    console.info("[bpoint-webhook] missing ResultKey — no-op", { url: req.url });
    return NextResponse.json({ received: true });
  }

  let txn: Awaited<ReturnType<typeof retrieveTransaction>>;
  try {
    txn = await retrieveTransaction(resultKey);
  } catch (err) {
    console.error("[bpoint-webhook] retrieveTransaction threw", {
      resultKey,
      err: err instanceof Error ? err.message : String(err),
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json({ received: true }); // WEBH-04: always 200
  }

  const apiOk = txn.APIResponse?.ResponseCode === 0;
  const approved = apiOk && txn.TxnResp?.Approved === true;

  if (!approved || !txn.TxnResp) {
    console.info("[bpoint-webhook] payment not approved — no-op", {
      apiResponseCode: txn.APIResponse?.ResponseCode ?? null,
      approved: txn.TxnResp?.Approved ?? null,
    });
    return NextResponse.json({ received: true }); // silent no-op, not a redirect
  }

  const { TxnNumber, Crn1: sessionId, Amount: amountCents } = txn.TxnResp;

  const dedupeKey = `bpoint-txn:${TxnNumber}`;
  const created = await redis.set(dedupeKey, "pending", {
    nx: true,
    ex: DEDUPE_TTL_SECONDS,
  });

  if (created !== "OK") {
    console.info("[bpoint-webhook] duplicate ignored (confirm route already ran)", {
      bpointTxnNumber: TxnNumber,
    });
    return NextResponse.json({ received: true });
  }

  // Fan-out — wrapped so fan-out failures never cause non-200 (WEBH-04)
  try {
    await handleConfirmedPayment({ sessionId, bpointTxnNumber: TxnNumber, amountCents });
  } catch (err) {
    console.error("[bpoint-webhook] fan-out failed", {
      tag: "[bpoint-webhook]",
      phase: "fan-out",
      bpointTxnNumber: TxnNumber,
      sessionId,
      err: {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
      timestamp: new Date().toISOString(),
    });
  }

  return NextResponse.json({ received: true }); // WEBH-04
}
```

### Pattern 2: WebHookUrl Field in createAuthKey

**What:** `WebHookUrl` is an optional field in the `ProcessTxnData` object of the BPoint v2 AuthKey creation request. It receives the server-to-server callback after transaction completion.

**Confirmed field name:** `WebHookUrl` (BPoint v2 API documentation, verified via `bpoint.com.au/developers/v2/`). This is a per-AuthKey registration — no merchant portal configuration required.

**Change to `src/lib/bpoint.ts#createAuthKey`:**

```typescript
// Add WebHookUrl to ProcessTxnData in createAuthKey
body: JSON.stringify({
  ProcessTxnData: {
    Action: "payment",
    Amount: pricing.amount,
    Crn1: args.sessionId,
    CurrencyCode: "AUD",
    MerchantReference: pricing.lineItem,
    RedirectionUrl: `${args.redirectionUrlBase}/api/checkout/confirm`,
    WebHookUrl: args.webhookUrlBase             // ADD THIS
      ? `${args.webhookUrlBase}/api/webhooks/bpoint`
      : undefined,
    IsTestTxn: cfg.isTestTxn,
    ExpiryInMinutes: 30,
  },
}),
```

**Updated `CreateAuthKeyArgs` interface:**

```typescript
export interface CreateAuthKeyArgs {
  sessionId: string;
  urgency: CheckoutUrgency;
  redirectionUrlBase: string;
  webhookUrlBase?: string;  // ADD: defaults to undefined (BPoint skips webhook if absent)
}
```

**Call site in `POST /api/checkout` route:** Pass `NEXT_PUBLIC_URL` as `webhookUrlBase`. This is already available — it is the same env var used for `redirectionUrlBase`.

### Pattern 3: checkout/resume Port to BPoint

**What:** Replace Stripe session retrieval in `src/app/api/checkout/resume/route.ts` with BPoint AuthKey reuse/refresh logic. The current file calls `getStripe().checkout.sessions.retrieve(intake.bpointTxnNumber)` and `createCheckoutSession(...)` — both must be replaced.

**New behavior:**
1. Look up intake by `sessionId`. If null → redirect to `/?expired=1`.
2. If `intake.bpointTxnNumber` is set: check if AuthKey is still within the 30-min TTL. If valid, re-render the iframe with the existing AuthKey (redirect to the BPoint iframe URL directly, or redirect to `/?payment=resume` and let the chat-widget re-mount PaymentCard). If expired, fall through to step 3.
3. Create a fresh AuthKey via `createAuthKey({ sessionId, urgency: intake.urgency, redirectionUrlBase, webhookUrlBase })`, call `updateIntake(sessionId, { bpointTxnNumber: freshAuthKey })`, then redirect to `/?payment=resume` (or the iframe embed URL).

**Implementation note:** The AuthKey itself IS the BPoint "session" — there is no retrieve-by-ID API equivalent to Stripe's `sessions.retrieve`. The 30-min TTL is enforced by BPoint server-side. If the user re-opens the resume link within 30 minutes of the original `createAuthKey` call, the same AuthKey may still be valid; but without a BPoint API to check AuthKey status, the simplest safe approach is to always create a fresh AuthKey on resume (matching the CONTEXT.md decision: "if expired or missing — create a fresh AuthKey, overwrite `bpointTxnNumber` via `updateIntake`"). The "still valid" case is the nice-to-have branch; the always-refresh path is the safe fallback.

```typescript
// src/app/api/checkout/resume/route.ts (ported)
import { NextResponse, type NextRequest } from "next/server";
import { createAuthKey } from "@/lib/bpoint";
import { getIntake, updateIntake } from "@/lib/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session");
  const appUrl = process.env.NEXT_PUBLIC_URL ?? "";

  if (!sessionId) {
    return NextResponse.redirect(`${appUrl}/?expired=1`);
  }

  const intake = await getIntake(sessionId);
  if (!intake) {
    return NextResponse.redirect(`${appUrl}/?expired=1`);
  }

  // Create a fresh AuthKey — BPoint has no retrieve-by-AuthKey API.
  // If the original AuthKey was still valid, BPoint will just issue a new one.
  try {
    const authKey = await createAuthKey({
      sessionId: intake.sessionId,
      urgency: intake.urgency,
      redirectionUrlBase: appUrl,
      webhookUrlBase: appUrl,
    });
    await updateIntake(sessionId, { bpointTxnNumber: authKey });
    return NextResponse.redirect(`${appUrl}/?payment=resume`);
  } catch (err) {
    console.error("[checkout/resume] failed to create fresh AuthKey", err);
    return NextResponse.redirect(`${appUrl}/?expired=1`);
  }
}
```

### Pattern 4: Stripe Deletion Sequencing

**Order (from CONTEXT.md — locked):**
1. Build `POST /api/webhooks/bpoint` (webhook becomes safety net).
2. Port `src/app/api/checkout/resume/route.ts` to BPoint (removes last `getStripe()` caller).
3. Delete `src/lib/stripe.ts` and `src/app/api/webhooks/stripe/route.ts` in a single commit.
4. Rename `stripe-session:` → `bpoint-txn:` in `src/scripts/revoke-upload-token.ts`.
5. Scrub `.env.example` (remove 3 Stripe vars) and `.planning/codebase/INTEGRATIONS.md` (remove Stripe entries).
6. `npm uninstall stripe @stripe/stripe-js @stripe/react-stripe-js` + verify build + lint.

**Why sequential:** Step 2 must complete before step 3. If `src/lib/stripe.ts` is deleted while `resume/route.ts` still imports from it, TypeScript compilation breaks and `npm run build` fails.

### Anti-Patterns to Avoid

- **Deleting `src/lib/stripe.ts` before porting `resume/route.ts`:** TypeScript will fail — `resume/route.ts` currently imports `{ createCheckoutSession, getStripe }` from `@/lib/stripe`. Delete after porting.
- **Using `req.json()` to parse the BPoint webhook body:** The v2 body schema is undocumented in public sources. Parse only from URL query string for now; the body can be added later once a real payload is captured.
- **Returning non-200 from the webhook on fan-out failures:** BPoint interprets non-2xx as delivery failure and may retry. Catch all errors and always return 200.
- **Checking `ResponseCode` string versus number:** `bpoint.ts#retrieveTransaction` already deserializes the response — `APIResponse.ResponseCode` is a `number` (0, not `"0"`). The webhook must match the same comparison (`=== 0`, not `=== "0"`). The confirm route already does this correctly.
- **Adding `WebHookUrl` without also updating `CreateAuthKeyArgs` type:** TypeScript will flag the unknown field on `ProcessTxnData` body object unless the args interface is updated.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Idempotency on BPoint retries | Custom dedup table | Redis SETNX (`bpoint-txn:{TxnNumber}`) | Already established in Phase 2; same key, same TTL |
| BPoint response parsing | New type definitions | Reuse `BPointTxnResp`, `BPointTxnResponse` from `src/lib/bpoint.ts` | Phase 2 already built and tested these types |
| Fan-out after payment | Duplicate fan-out code in webhook | Import `handleConfirmedPayment` from Phase 2 | WEBH-03 requirement; DRY enforces consistency |
| Webhook authentication | HMAC signature verification | `retrieveTransaction` server-side re-verification | BPoint v2 callbacks are unsigned; re-verify is the correct pattern |
| Stripe package check | Manual grep | `npm run build` + `npm run lint` after `npm uninstall` | TypeScript compilation catches all remaining Stripe imports |

---

## Common Pitfalls

### Pitfall 1: Deleting Stripe Files Before Porting resume/route.ts

**What goes wrong:** TypeScript compilation fails. `src/app/api/checkout/resume/route.ts` imports `{ createCheckoutSession, getStripe }` from `@/lib/stripe` — deleting `stripe.ts` first breaks the build.

**Why it happens:** The cleanup sequencing feels natural to do in one pass, but `resume/route.ts` is easy to overlook because it is not in the `webhooks/stripe/` path.

**How to avoid:** Port `resume/route.ts` first. Confirm `npm run build` passes. Then delete `src/lib/stripe.ts` and `src/app/api/webhooks/stripe/route.ts` together.

**Warning signs:** `npm run build` or `npm run lint` throws `Module not found: @/lib/stripe` after deletion.

### Pitfall 2: ResponseCode Numeric vs String Mismatch

**What goes wrong:** The webhook dual-verification check `txn.APIResponse?.ResponseCode === 0` silently fails if the comparison uses `=== "0"` (string). BPoint returns a number.

**Why it happens:** The research docs historically showed string comparison; Phase 2 VERIFICATION.md confirms the actual response uses a numeric `ResponseCode`. Copying old code patterns can introduce the wrong type.

**How to avoid:** Mirror `src/app/api/checkout/confirm/route.ts:81` exactly: `txn.APIResponse?.ResponseCode === 0` (number, not string).

### Pitfall 3: WebHookUrl Absent From ProcessTxnData Causes Silent No Callbacks

**What goes wrong:** If `WebHookUrl` is omitted from `createAuthKey`'s `ProcessTxnData`, BPoint never sends a server-to-server callback. The webhook route is built and deployed but never fires.

**Why it happens:** The field is optional — BPoint will not reject the AuthKey creation request if `WebHookUrl` is missing. The error is invisible at AuthKey creation time.

**How to avoid:** After adding `WebHookUrl` to `createAuthKey`, also update the `POST /api/checkout` route call site to pass `webhookUrlBase: process.env.NEXT_PUBLIC_URL`. Verify via UAT by checking server logs for `[bpoint-webhook]` entries after a test transaction.

### Pitfall 4: npm uninstall Leaves Orphaned TypeScript Types

**What goes wrong:** After `npm uninstall stripe @stripe/stripe-js @stripe/react-stripe-js`, the Stripe types (`Stripe.Checkout.Session`, etc.) may still be referenced in TypeScript type comments or JSDoc in files that weren't deleted. `npm run build` will error on missing types even if the runtime code is removed.

**Why it happens:** Type-only imports and JSDoc references survive code deletion.

**How to avoid:** Run `npm run lint` and `npm run build` immediately after uninstall. TypeScript will surface all remaining references.

### Pitfall 5: INTEGRATIONS.md Stripe Entries Not Fully Scrubbed

**What goes wrong:** `.planning/codebase/INTEGRATIONS.md` contains multiple Stripe references — not just the Payment Processing section but also the Required env vars section (lines ~170-175) and the Incoming Webhooks section (line ~209). Partial scrubbing leaves misleading documentation.

**Why it happens:** The env var scrubbing decision in CONTEXT.md mentions `.env.example` and `INTEGRATIONS.md` but the webhook section in INTEGRATIONS.md is easy to miss.

**How to avoid:** Search INTEGRATIONS.md for all occurrences of "Stripe" or "STRIPE_" and remove or mark each one. The file has three distinct Stripe sections: Payment Processing (deprecated note), Required env vars list, Incoming Webhooks (`POST /api/webhooks/stripe`).

---

## Code Examples

### Confirmed Existing Code: Current resume/route.ts (Stripe-dependent — must be ported)

```typescript
// src/app/api/checkout/resume/route.ts — CURRENT (delete this logic)
import { createCheckoutSession, getStripe } from "@/lib/stripe";  // DELETE
// ...
if (intake.bpointTxnNumber) {
  const existing = await getStripe().checkout.sessions.retrieve(intake.bpointTxnNumber); // DELETE
  // ...
}
const fresh = await createCheckoutSession({ ... }); // DELETE
await updateIntake(sessionId, { bpointTxnNumber: fresh.id }); // KEEP, change fresh.id to authKey
```

### Confirmed Existing Code: stripe-session: prefix in revoke-upload-token.ts (must rename)

```typescript
// src/scripts/revoke-upload-token.ts line 18 — CURRENT (rename key prefix)
const dedupeKey = `stripe-session:${sessionId}`;  // BEFORE

// AFTER:
const dedupeKey = `bpoint-txn:${sessionId}`;
```

### Confirmed Existing Code: .env.example Stripe vars (must delete)

```bash
# Lines 17-19 in .env.example — DELETE these three lines + the DEPRECATED comment block
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
```

### Confirmed: SETNX dedup pattern (copy from confirm route, identical in webhook)

```typescript
// Identical in both confirm route and webhook handler
const dedupeKey = `bpoint-txn:${TxnNumber}`;
const created = await redis.set(dedupeKey, "pending", {
  nx: true,
  ex: DEDUPE_TTL_SECONDS, // 604800 — 7 days
});
if (created !== "OK") {
  // Duplicate — other path already ran fan-out
  return NextResponse.json({ received: true });
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Stripe HMAC-signed webhook events | BPoint `WebHookUrl` + `retrieveTransaction` re-verification | Phase 3 (this phase) | Security model shifts from signature-based to re-verification-based — equivalent security floor for unsigned BPoint callbacks |
| `stripe-session:{id}` Redis dedup key | `bpoint-txn:{TxnNumber}` Redis dedup key | Phase 2 (confirm route) + Phase 3 (revoke script) | Key namespace fully migrated; revoke script is the last `stripe-session:` usage |
| Stripe session reuse via `sessions.retrieve` | BPoint fresh AuthKey creation on resume | Phase 3 (this phase) | BPoint has no retrieve-by-AuthKey API; always-create-fresh is the equivalent safe pattern |
| `stripe-session:` prefix in `revoke-upload-token.ts` | `bpoint-txn:` prefix | Phase 3 (this phase) | Alignment with Phase 2 dedup namespace |

**Removed in this phase:**
- `src/lib/stripe.ts` — Stripe singleton, `createCheckoutSession`, PRICING re-export
- `src/app/api/webhooks/stripe/route.ts` — Stripe webhook handler (HMAC, fan-out)
- `stripe`, `@stripe/stripe-js`, `@stripe/react-stripe-js` packages from `package.json`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` from `.env.example`

---

## Open Questions

1. **BPoint WebHookUrl callback payload schema**
   - What we know: BPoint v2 docs reference `WebHookUrl` as an optional callback URL. The callback is a server POST. The URL query string carries `ResultKey` (same as browser redirect). The body schema is not documented in publicly accessible sources.
   - What's unclear: Does the callback body contain JSON (and if so, what fields)? Is the `ResultKey` always in the query string, or sometimes in the body?
   - Recommendation: **The locked decision handles this correctly — read `ResultKey` from the query string only, do not parse the body.** This is safe and works regardless of body content. If a UAT test transaction reveals a body, log it at info level and add body parsing in Phase 4.

2. **checkout/resume: Does BPoint support AuthKey status check?**
   - What we know: BPoint v2 has no documented "retrieve-by-AuthKey" endpoint. The `retrieveTransaction` endpoint takes a `ResultKey` (post-transaction), not an `AuthKey`.
   - What's unclear: Whether there is an undocumented or v5-only AuthKey status check.
   - Recommendation: Always create a fresh AuthKey on resume. This is safe, matches the CONTEXT.md decision, and avoids an API call that may not exist.

3. **`NEXT_PUBLIC_URL` accuracy on Vercel preview deployments**
   - What we know: `NEXT_PUBLIC_URL` is the configured canonical origin. On Vercel previews, this may point to the production URL rather than the preview URL.
   - What's unclear: Whether BPoint will successfully POST to a preview URL if `NEXT_PUBLIC_URL` is set to production.
   - Recommendation: This is an ops concern, not a Phase 3 code concern. Note in the completion summary that `NEXT_PUBLIC_URL` must be set correctly per Vercel environment before UAT testing.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.9 (installed in Phase 2 Wave 0) |
| Config file | `vitest.config.mts` |
| Quick run command | `npm test` (`vitest run --reporter=dot`) |
| Full suite command | `npm test` (all 40 tests in `tests/**/*.test.{ts,tsx}`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WEBH-01 | POST /api/webhooks/bpoint route exists and returns 200 | unit | `npm test -- --reporter=verbose tests/webhook-bpoint.test.ts` | ❌ Wave 0 |
| WEBH-02 | Webhook calls retrieveTransaction with ResultKey from query string | unit | `npm test -- tests/webhook-bpoint.test.ts` | ❌ Wave 0 |
| WEBH-03 | Webhook imports and calls handleConfirmedPayment (not duplicate code) | unit | `npm test -- tests/webhook-bpoint.test.ts` | ❌ Wave 0 |
| WEBH-04 | Webhook returns 200 even when fan-out throws | unit | `npm test -- tests/webhook-bpoint.test.ts` | ❌ Wave 0 |
| CLEAN-01 | Stripe packages absent from package.json | build | `npm run build` (TypeScript fails if any import remains) | N/A — build check |
| CLEAN-02 | Stripe source files deleted, no remaining imports | build + lint | `npm run build && npm run lint` | N/A — build check |
| CLEAN-03 | Stripe vars absent from .env.example | grep | `grep -c STRIPE_ .env.example` must return 0 | N/A — static check |

### Webhook Test Cases (tests/webhook-bpoint.test.ts — Wave 0)

Mirror the confirm-route test structure. Required cases:

1. Returns 200 when `ResultKey` is missing (no-op)
2. Calls `retrieveTransaction` with the `ResultKey` from query string
3. Returns 200 (no fan-out) when `Approved === false`
4. Returns 200 (no fan-out) when `APIResponse.ResponseCode !== 0`
5. Calls `handleConfirmedPayment` with correct args when approved + SETNX succeeds
6. Does NOT call `handleConfirmedPayment` when SETNX returns null (dedup)
7. Returns 200 even when `handleConfirmedPayment` throws (WEBH-04)
8. Returns 200 even when `retrieveTransaction` throws (WEBH-04)

Mocks needed (same pattern as `tests/confirm-route.test.ts`):
```typescript
vi.mock("@/lib/bpoint", () => ({ retrieveTransaction: vi.fn() }));
vi.mock("@/lib/payments/handleConfirmedPayment", () => ({ handleConfirmedPayment: vi.fn() }));
vi.mock("@/lib/kv", () => ({ redis: { set: vi.fn() } }));
```

Reuse `tests/fixtures/bpoint-responses.ts` (already contains `approvedTxnResponse`, `declinedTxnResponse`, `expiredAuthKeyResponse`).

### Sampling Rate

- **Per task commit:** `npm test` — full suite, currently 40 tests, runs in < 2s
- **Per wave merge:** `npm test && npm run build && npm run lint`
- **Phase gate:** All three commands green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/webhook-bpoint.test.ts` — 8 test cases covering WEBH-01..04
- [ ] No new framework config needed — `vitest.config.mts` `environmentMatchGlobs` uses `node` default for `.ts` files (correct for route unit tests)
- [ ] No new fixtures needed — reuse `tests/fixtures/bpoint-responses.ts`

---

## Sources

### Primary (HIGH confidence)

- Direct file read: `src/app/api/checkout/confirm/route.ts` — confirm route as webhook structural template
- Direct file read: `src/lib/payments/handleConfirmedPayment.ts` — shared fan-out helper, already built for Phase 3 reuse
- Direct file read: `src/lib/bpoint.ts` — `retrieveTransaction`, `BPointTxnResp`, `BPointTxnResponse` types already present; `createAuthKey` needs `WebHookUrl` addition
- Direct file read: `src/app/api/checkout/resume/route.ts` — confirmed Stripe dependencies to be ported
- Direct file read: `src/app/api/webhooks/stripe/route.ts` — "always 200" webhook pattern reference + logging shape
- Direct file read: `src/scripts/revoke-upload-token.ts` — `stripe-session:` prefix on line 18 (rename target)
- Direct file read: `.env.example` lines 17-19 — three Stripe vars to scrub
- Direct file read: `package.json` — confirms `stripe`, `@stripe/stripe-js`, `@stripe/react-stripe-js` in production dependencies
- Direct file read: `tests/confirm-route.test.ts` + `vitest.config.mts` — test structure and environment config to mirror

### Secondary (MEDIUM confidence)

- BPoint v2 API documentation (`bpoint.com.au/developers/v2/`) via WebFetch — confirmed `WebHookUrl` as the per-AuthKey notification URL field name; confirmed it is optional and registered per-request (not merchant portal)
- BPoint UAT docs (`bpoint.uat.linkly.com.au/developers/v2/`) via WebFetch — same field name confirmed
- `.planning/phases/02-confirmation-ui/02-VERIFICATION.md` — confirmed Phase 2 code is complete, 40/40 tests green, `handleConfirmedPayment` ready for Phase 3 webhook reuse

### Tertiary (LOW confidence — for background only)

- `.planning/research/PITFALLS.md` — BPoint callback is unsigned (confirms trust-via-retrieve decision); dedup-before-side-effects pattern
- `.planning/research/ARCHITECTURE.md` — webhook as secondary confirmation pattern (architecture confirmed complete in Phase 2)
- omnipay-bpoint GitHub — dual `ResponseCode + Approved` check pattern (cross-reference)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages confirmed via `package.json` direct read
- Architecture: HIGH — webhook handler pattern derived directly from existing confirm route code; no speculation
- BPoint `WebHookUrl` field name: HIGH — confirmed via official BPoint v2 docs (two URLs)
- BPoint webhook body schema: LOW — no public documentation; handled by URL-only parsing decision (locked)
- Pitfalls: HIGH — derived from actual code inspection of deletion targets

**Research date:** 2026-04-24
**Valid until:** Stable (BPoint v2 API contract; 90-day shelf life minimum)
