# Phase 1: Foundation - Research

**Researched:** 2026-04-23
**Domain:** BPoint v5 server-side API client + session-schema rename across Next.js App Router
**Confidence:** HIGH for codebase integration points; MEDIUM for BPoint API specifics (v5 docs are a React SPA; request/response field shapes corroborated via prior project research, third-party drivers, and context docs)

## Summary

Phase 1 is a server-only migration. It swaps the payment-session creation primitive (Stripe `checkout.sessions.create` → BPoint `createAuthKey`), renames the persisted identifier field (`stripeSessionId` → `bpointTxnNumber`) across the TypeScript surface, and changes the shape of the `POST /api/checkout` JSON response (`{ clientSecret }` → `{ authKey }`). It touches 8 files and introduces 2 new modules (`src/lib/bpoint.ts`, `src/lib/pricing.ts`). No UI work, no confirm route, no webhook work — those are Phase 2 and Phase 3.

The work is mostly mechanical once three things are locked: (1) the BPoint Basic Auth encoding uses a **non-standard** `username|merchantnumber:password` format — standard `btoa(user:pass)` is wrong and will produce a silent 401; (2) `Amount` is an **integer in cents** (132000 / 72600) — float or dollars will undercharge 100×; (3) `IsTestTxn` is evaluated **per-request** from `process.env.BPOINT_ENV !== "prod"`, not cached at module load.

Because CONTEXT.md locks the implementation strategy (hard rename, no shim, breaking response change, `pricing.ts` extraction), this research focuses on *how to execute those decisions safely* rather than evaluating alternatives.

**Primary recommendation:** Build `src/lib/pricing.ts` first (extract `PRICING` + `CheckoutUrgency` verbatim from `src/lib/stripe.ts:18-33`), then `src/lib/bpoint.ts` mirroring the `getStripe()` lazy-singleton shape (`src/lib/stripe.ts:3-13`), then do the field rename in a single pass so TypeScript catches every call site, then swap `POST /api/checkout`'s body. Verification gate: `curl -X POST /api/checkout -d '{"sessionId":"x","urgency":"urgent"}'` returns `{ authKey: "<uuid>" }` and `npx tsc --noEmit` is clean.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Type rename strategy**
- **Hard rename, single pass.** `stripeSessionId` → `bpointTxnNumber` updated in every reference during Phase 1. No additive/coexistence period, no type alias shim.
- Applies to: `src/types/index.ts` (SessionData), `src/lib/kv.ts` (createSession default), `src/lib/intake.ts`, `src/lib/resend.ts`, `src/app/api/checkout/route.ts`, `src/app/api/checkout/resume/route.ts`, `src/scripts/revoke-upload-token.ts`, and the existing Stripe webhook at `src/app/api/webhooks/stripe/route.ts`.
- Stripe webhook handling during Phase 1 soak: planner decides between (a) updating the webhook's field reads to use `bpointTxnNumber` as a neutral identifier, or (b) no-op'ing the webhook body until Phase 3 deletes it. Either is acceptable; the file still exists on disk until Phase 3.
- Roadmap success criterion #3 is the acceptance gate — zero TypeScript errors across the codebase.

**Pricing module location**
- **Extract to `src/lib/pricing.ts`** — provider-neutral module. Exports `PRICING` object and `CheckoutUrgency` type.
- `src/lib/bpoint.ts` imports pricing from `src/lib/pricing.ts`.
- `src/lib/stripe.ts` (still present during Phase 1–3 soak) imports pricing from `src/lib/pricing.ts` — no duplication.
- Exact `lineItem` strings preserved verbatim: "Initial Deposit for Urgent Court Matter", "Legal Strategy Session" (Smokeball reconciliation is non-negotiable).
- Amounts preserved as integer cents: Urgent 132000, Non-Urgent 72600. DATA-03 compliant.

**IsTestTxn env gating**
- **`IsTestTxn = process.env.BPOINT_ENV !== "prod"`**. Fail-safe default: unset or typo → test mode (no real charges).
- Production requires explicit opt-in via `BPOINT_ENV=prod`. Aligns with existing INTEGRATIONS.md note.
- Do NOT couple to `NODE_ENV` or `VERCEL_ENV` — preview deploys should stay in test mode by default.
- Must be evaluated at AuthKey-creation time (per-request), not at module load, to avoid caching stale bundle-time values on serverless platforms.

**Checkout route response shape**
- **Breaking change: `POST /api/checkout` returns `{ authKey: string }`** (UUID string from BPoint AuthKey creation).
- No compat shim, no `clientSecret` alias. The existing PaymentCard will fail to boot after Phase 1 — that is expected and short-lived. Phase 2 immediately replaces PaymentCard with a BPoint iframe and wires it to the new field.
- Roadmap success criterion #1 is the acceptance gate: `curl POST /api/checkout` returns an authKey UUID, not a Stripe clientSecret.

**AuthKey expiry (SESS-05)**
- AuthKey session TTL is 30 minutes. Configured at AuthKey-creation time against BPoint (matches existing Stripe `expires_at: Math.floor(Date.now() / 1000) + 30 * 60` pattern).
- Redis session TTL (separate concern) stays at 1 hour as today — no change.

**BPoint API client (SESS-01)**
- New file: `src/lib/bpoint.ts`. Named exports, lazy singleton if credentials are read at runtime (follow the `getStripe()` pattern from `src/lib/stripe.ts`).
- Basic Auth header format: `Authorization: Basic base64(username|merchantnumber:password)` — the pipe character is part of the BPoint API spec, not a typo.
- Required env vars (already documented in INTEGRATIONS.md): `BPOINT_API_USERNAME`, `BPOINT_API_PASSWORD`, `BPOINT_MERCHANT_NUMBER`. Optional: `BPOINT_BILLER_CODE`, `BPOINT_ENV`.
- Base URL derived from `BPOINT_ENV`: `prod` → production BPoint endpoint, else UAT (`bpoint.uat.linkly.com.au`).
- Throw with descriptive messages if required env vars are missing (match the `STRIPE_SECRET_KEY is not configured` pattern in `src/lib/stripe.ts`).

**AuthKey session creation (SESS-02)**
- POST to BPoint AuthKey endpoint with: `Amount` (integer cents), `Crn1 = sessionId`, `RedirectionUrl = ${NEXT_PUBLIC_URL}/api/checkout/confirm` (route itself is built in Phase 2, but the URL is baked into the AuthKey request now).
- `CurrencyCode: "AUD"`.
- `IsTestTxn` evaluated per decision above.
- On success, persist the returned AuthKey UUID to the intake record's `bpointTxnNumber` field (mirrors the existing `updateIntake(sessionId, { stripeSessionId: checkoutSession.id })` pattern in `src/app/api/checkout/route.ts`).

**Zapier transcript field (DATA-02)**
- The firm's Zap monitors the transcript email for payment identifier fields. Field structure must be preserved — rename the field label/value source from Stripe session id to `bpointTxnNumber`, but do not add, remove, or reorder fields in the transcript email template or `sendTranscriptEmail` payload.
- Planner must audit `src/lib/resend.ts` to confirm transcript email payload shape remains compatible.

### Claude's Discretion
- Exact function signatures and internal shape of `src/lib/bpoint.ts` (one module with functions vs a class — follow codebase conventions).
- Whether to extract a `createAuthKey()` helper or inline AuthKey creation in `/api/checkout/route.ts`.
- Error-tag prefix for `bpoint.ts` logs (suggest `[bpoint]` matching `[checkout]`/`[stripe]` convention).
- Zod schema for the BPoint AuthKey response (add if it aids type safety; skip if JSON.parse + TypeScript cast is consistent with existing external API calls).
- Whether to update the Stripe webhook in-place or no-op it for the Phase 1–3 soak (either is acceptable; full deletion happens in Phase 3).

### Deferred Ideas (OUT OF SCOPE)
- BPoint JavaScript iframe integration + PaymentCard component rewrite → Phase 2 (UI-01..04, CONF-01..05)
- Retrieve Transaction Result API + confirm route → Phase 2
- Server-to-server webhook handler + `handleConfirmedPayment()` shared helper → Phase 3 (WEBH-01..04)
- Stripe npm package + source file removal → Phase 3 (CLEAN-01..03)
- UAT end-to-end test execution → Phase 4 (TEST-01..03)
- Zod schema for BPoint callback payload (blocked on capturing a real v5 UAT payload per STATE.md blocker) → Phase 3
- Search Transactions fallback, refund API, BPoint token storage → v2 (RESL-01..02, REFD-01..02, TOKN-01)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SESS-01 | BPoint API client module authenticates with `username\|merchantnumber:password` Basic Auth | "Standard Stack" → Node 20 `Buffer.from(...).toString("base64")`; "Pitfall: Malformed Authentication Header" documents the pipe-separator format and a dev-only sanity assertion. Code Example 1 is a drop-in `buildBasicAuth()` helper. |
| SESS-02 | AuthKey endpoint creates one-time key with `Amount` (cents), `Crn1=sessionId`, `RedirectionUrl` | "Architecture Patterns → Pattern 1: AuthKey-Then-Iframe" shows exact request body. Code Example 2 mirrors the shape adjusted for `IsTestTxn` + 30-min TTL. |
| SESS-03 | Two-tier pricing preserved with exact `lineItem` strings | "Architecture Patterns → Pattern 2: Provider-Neutral Pricing Module" + Code Example 3. `src/lib/stripe.ts:18-31` provides the verbatim source of truth for lineItem/amount/tier/displayPrice. |
| SESS-04 | `IsTestTxn` strictly controlled by environment, never leaks to prod | "Common Pitfalls → Pitfall 3: IsTestTxn Leakage" + Code Example 4. Fail-safe default: `process.env.BPOINT_ENV !== "prod"` evaluated per-request. |
| SESS-05 | AuthKey expires after 30 minutes | Pattern 1 sets TTL at AuthKey-creation time. Reuse literal `30 * 60` seconds to stay consistent with `src/lib/stripe.ts:63`. BPoint supports per-AuthKey expiry via request body (`SubType` / expiry fields; see Open Question 2). |
| DATA-01 | `stripeSessionId` → `bpointTxnNumber` across types, Redis, intake, email | Codebase grep identifies all 8 call sites (see "Rename Surface" table). TypeScript `tsc --noEmit` is the acceptance gate. |
| DATA-02 | Zapier transcript fields preserve structure | "Common Pitfalls → Pitfall 5: lineItem Drift" + `src/lib/resend.ts:40` is the single Zapier-monitored row. Rename label value but keep row position/structure identical. |
| DATA-03 | `paymentAmount` stored as integer cents | Already cents in `src/lib/intake.ts:20` (`amountCents: number`) and `src/types/index.ts:16` (`paymentAmount: number`). No schema change — just ensure `PRICING` amounts remain integer cents (132000/72600) in the extracted `pricing.ts`. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `fetch` (built-in) | Node 20+ | HTTP client for BPoint REST API | Native in Next.js 16 runtime; no extra dependency. Existing codebase uses it (`resend.ts`, inferred). Avoids pulling `axios`/`undici` wrapper libraries. |
| Node.js `Buffer` | Node 20+ | Base64-encode Basic Auth header | Required for `username\|merchantnumber:password` encoding. Native. |
| TypeScript | ^5 (existing) | Type-safe BPoint request/response interfaces | Existing project standard. |
| Zod | ^4.3.6 (existing) | **Optional** runtime validation of BPoint AuthKey response | Only if planner decides response validation aids type safety. Existing Zod usage is in AI SDK tools (`inputSchema`), not external API responses — so skipping Zod here matches codebase convention. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@upstash/redis` | ^1.37.0 (existing) | Unchanged — Redis session store | Only touched for the `stripeSessionId` → `bpointTxnNumber` default in `createSession()` default object (`src/lib/kv.ts:28`). |
| `resend` | ^6.10.0 (existing) | Unchanged — transactional email | Only touched to rename the transcript email field label + param (`src/lib/resend.ts`). |
| `next` | 16.2.3 (existing) | App Router API routes | `NextResponse.json` continues to be the response primitive. No Next-specific BPoint library exists. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native `fetch` | `axios` / `got` / `undici` | Extra dependency + bundle size. `fetch` is sufficient for one AuthKey POST + future Retrieve GET. **Rejected.** |
| Hand-rolled Basic Auth | An npm package like `basic-auth-builder` | Trivial one-liner in Node — `Buffer.from(...).toString("base64")`. Extra dep is overkill. **Rejected.** |
| Community SOAP/omnipay-bpoint driver | PHP-only (`wakeless-net/omnipay-bpoint`) | Not applicable in Node. **Rejected.** |
| Node BPoint SDK | None published by CBA | CBA does not ship an official Node SDK. Direct REST integration is the only path. **Confirmed: build the client.** |

**Installation:** No new dependencies. All required tools are already in `package.json` or Node built-in.

**Version verification:** Not applicable — no new packages added. Existing `zod@^4.3.6`, `@upstash/redis@^1.37.0`, `resend@^6.10.0`, `next@16.2.3` are the latest used project-wide (see `package.json:11-31`).

## Architecture Patterns

### Recommended Project Structure

```
src/
├── lib/
│   ├── pricing.ts          # NEW: provider-neutral PRICING + CheckoutUrgency
│   ├── bpoint.ts           # NEW: getBpointConfig() + createAuthKey() + types
│   ├── stripe.ts           # MODIFY: remove PRICING, import from pricing.ts
│   ├── kv.ts               # MODIFY: rename stripeSessionId → bpointTxnNumber default
│   ├── intake.ts           # MODIFY: rename field across IntakeRecord + createIntake
│   └── resend.ts           # MODIFY: rename param + transcript-email table row label
├── types/
│   └── index.ts            # MODIFY: rename field in SessionData
├── app/api/
│   ├── checkout/
│   │   ├── route.ts        # MODIFY: call createAuthKey, return { authKey }
│   │   └── resume/
│   │       └── route.ts    # MODIFY: rename field references (Phase 2 rewrites logic)
│   └── webhooks/
│       └── stripe/
│           └── route.ts    # MODIFY: rename field refs OR no-op (planner decides)
└── scripts/
    └── revoke-upload-token.ts  # MODIFY: rename CLI flag help text
```

**Why this structure:**
- `pricing.ts` as a separate module is the cleanest way to serve both `stripe.ts` (during soak) and `bpoint.ts` without import cycles or duplication. Provider-neutral naming honors the Phase 3 deletion of `stripe.ts` without needing another move.
- `bpoint.ts` sits alongside `stripe.ts` during the soak, mirroring the existing single-file-per-integration convention (see `src/lib/resend.ts`, hypothetical `src/lib/openrouter.ts` per CONVENTIONS.md).
- No new directories are introduced — Phase 1 is strictly additive-within-`lib/` plus in-place renames.

### Pattern 1: AuthKey-Then-Return (Phase 1 slice of 3-Party Flow)

**What:** Server creates a time-limited AuthKey that encodes amount, `Crn1` (session ID), and `RedirectionUrl`. Server returns `{ authKey }` to client. The iframe embed itself is **Phase 2** — Phase 1 stops at "AuthKey successfully returned from BPoint."

**When to use:** Always for BPoint-initiated payments (this is the v5 3-party standard flow).

**Trade-offs:** After Phase 1, the client-side PaymentCard breaks because it expects `{ clientSecret }`. This is intentional and documented — Phase 2 fixes it immediately. Curl-based contract testing during Phase 1 is the substitute for UI testing.

**Example:**
```typescript
// Source: .planning/research/ARCHITECTURE.md Pattern 1, adapted for CONTEXT.md decisions
// File: src/lib/bpoint.ts
import { PRICING, type CheckoutUrgency } from "@/lib/pricing";

interface BpointConfig {
  username: string;
  password: string;
  merchantNumber: string;
  baseUrl: string;
  isTestTxn: boolean;
}

function getBpointConfig(): BpointConfig {
  const username = process.env.BPOINT_API_USERNAME;
  const password = process.env.BPOINT_API_PASSWORD;
  const merchantNumber = process.env.BPOINT_MERCHANT_NUMBER;
  if (!username) throw new Error("BPOINT_API_USERNAME is not configured");
  if (!password) throw new Error("BPOINT_API_PASSWORD is not configured");
  if (!merchantNumber) throw new Error("BPOINT_MERCHANT_NUMBER is not configured");

  const isProd = process.env.BPOINT_ENV === "prod";
  return {
    username,
    password,
    merchantNumber,
    baseUrl: isProd
      ? "https://www.bpoint.com.au/webapi/v2"
      : "https://bpoint.uat.linkly.com.au/webapi/v2",
    isTestTxn: !isProd,
  };
}

export interface CreateAuthKeyArgs {
  sessionId: string;
  urgency: CheckoutUrgency;
  redirectionUrlBase: string;
}

export async function createAuthKey(args: CreateAuthKeyArgs): Promise<string> {
  const cfg = getBpointConfig();                       // evaluated per-call — SESS-04
  const pricing = PRICING[args.urgency];               // SESS-03
  const authHeader =
    "Basic " +
    Buffer.from(
      `${cfg.username}|${cfg.merchantNumber}:${cfg.password}`
    ).toString("base64");                              // SESS-01 (pipe is mandatory)

  const res = await fetch(`${cfg.baseUrl}/txns/authkey`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify({
      TxnReq: {
        Action: "payment",
        Amount: pricing.amount,                        // integer cents — DATA-03
        Crn1: args.sessionId,
        CurrencyCode: "AUD",
        MerchantReference: pricing.lineItem,
        RedirectionUrl: `${args.redirectionUrlBase}/api/checkout/confirm`,
        IsTestTxn: cfg.isTestTxn,                      // SESS-04
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("[bpoint] AuthKey creation failed", res.status, body);
    throw new Error(`BPoint AuthKey creation failed: ${res.status}`);
  }

  const data = (await res.json()) as { AuthKey?: string };
  if (!data.AuthKey) {
    throw new Error("BPoint response missing AuthKey field");
  }
  return data.AuthKey;                                 // SESS-02
}
```

### Pattern 2: Provider-Neutral Pricing Module

**What:** Extract `PRICING` from `src/lib/stripe.ts:18-31` verbatim into `src/lib/pricing.ts`. Both `stripe.ts` and `bpoint.ts` import from it during the Phase 1–3 soak.

**When to use:** Any time two payment-provider modules coexist. Single source of truth for `lineItem` strings protects Zapier/Smokeball reconciliation (DATA-02, pitfall 5).

**Example:**
```typescript
// Source: src/lib/stripe.ts:18-33, verbatim
// File: src/lib/pricing.ts

// `lineItem` is the firm-prescribed payment description (do not paraphrase) —
// it flows to the BPoint receipt and the Smokeball invoice line item for
// reconciliation. `tier` is the visitor-facing tier heading.
export const PRICING = {
  urgent: {
    amount: 132000,                                    // $1,320.00 in cents
    tier: "Urgent Criminal Matter",
    lineItem: "Initial Deposit for Urgent Court Matter",
    displayPrice: "$1,320.00 (incl. GST)",
  },
  "non-urgent": {
    amount: 72600,                                     // $726.00 in cents
    tier: "Non-Urgent Criminal Matter",
    lineItem: "Legal Strategy Session",
    displayPrice: "$726.00 (incl. GST)",
  },
} as const;

export type CheckoutUrgency = keyof typeof PRICING;
```

Then `src/lib/stripe.ts` becomes:
```typescript
// After Phase 1
import { PRICING, type CheckoutUrgency } from "@/lib/pricing";
export { PRICING, type CheckoutUrgency };              // re-export for back-compat during soak
// ...rest of stripe.ts unchanged
```

### Pattern 3: Lazy Singleton with Env Guards (Mirrored from `getStripe()`)

**What:** Defer all env-var reads until first call. Throw descriptive error on missing var. Evaluate `BPOINT_ENV` on every call (not cached).

**When to use:** Any module with required env vars in a serverless runtime. Phase 1's `getBpointConfig()` follows this pattern.

**Important divergence from `getStripe()`:** `stripe.ts` caches the `Stripe` client singleton because it is stateless and configuration-free after construction. `bpoint.ts` does **not** cache `BpointConfig` — `isTestTxn` must be re-evaluated per call. Build a fresh config object each call (cheap: four `process.env` reads).

### Anti-Patterns to Avoid

- **Module-level `IsTestTxn` constant.** `const IS_TEST = process.env.BPOINT_ENV !== "prod"` at module top level caches the value at bundle time on Vercel, which defeats per-request env gating. Always evaluate inside the function body. (CONTEXT.md decision, SESS-04.)
- **`btoa(user + ":" + pass)` for the auth header.** Standard Basic Auth — **wrong for BPoint**. Must include the pipe: `Buffer.from(\`${user}|${merchant}:${pass}\`).toString("base64")`. (See Pitfall 1.)
- **Keeping `stripeSessionId` as an alias/shim.** The decision is "hard rename, single pass." Additive coexistence leaves two fields in every Redis record and breaks the acceptance gate (TS-error-free). (CONTEXT.md decision.)
- **Converting `Amount` at the API call site.** If pricing is already in cents (it is — `src/lib/stripe.ts:19,25`), never multiply or format. Pass the integer directly. (See Pitfall 2.)
- **Using `NODE_ENV` or `VERCEL_ENV` to gate `IsTestTxn`.** Preview deploys should stay in test mode even on production-like NODE_ENV. Only `BPOINT_ENV === "prod"` flips live. (CONTEXT.md decision.)
- **Single combined route for future confirm + webhook.** Irrelevant to Phase 1 but flagged to prevent drift: Phase 2 must keep `/api/checkout/confirm` (GET, browser) and Phase 3 must keep `/api/webhooks/bpoint` (POST, server-to-server) as separate routes. Sharing a helper, not a route.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP client | `http.request` or `fetch` polyfill | Native `fetch` (Node 20+, Next.js 16 runtime) | Native, typed, no dependency. |
| Basic Auth encoding | Custom base64 implementation | `Buffer.from(s).toString("base64")` | Built-in, correct, audited. |
| UUID generation | Custom UUID generator for AuthKey | N/A — BPoint returns the AuthKey UUID; you store it | The server never generates UUIDs in this phase. |
| Amount formatting | `(dollars * 100).toFixed(0)` at call site | Store cents natively in `PRICING` | Float→cents conversion is a known 100× undercharge bug (Pitfall 2). |
| Zapier webhook client | Custom HTTP POST to Zapier | Unchanged — Resend transcript email IS the Zapier trigger | Zapier parses the existing email; no direct webhook call. Field structure must stay identical (DATA-02). |
| Env-var validation schemas | `t3-env` / Zod-env wrapper | Inline `if (!process.env.X) throw` (existing pattern in `stripe.ts:7-9`) | Codebase convention, zero deps, sufficient for 3 vars. |
| Retry/backoff for BPoint call | Exponential-backoff wrapper | Fail-fast; return 502 to caller | Phase 1 is single-attempt. Retries belong in Phase 2 (on redirect landing) or Phase 3 (webhook). |

**Key insight:** Phase 1 is an **integration** phase, not an infrastructure phase. The only "library-shaped" code is the 50-line `bpoint.ts`. Every impulse to add abstraction (env schema, retry wrapper, Zod response validator) should be resisted in favor of matching existing codebase conventions — this code lives alongside `stripe.ts` which is similarly thin.

## Common Pitfalls

### Pitfall 1: Malformed Auth Header (Standard `user:pass` Instead of `user|merchant:pass`)

**What goes wrong:** BPoint returns HTTP 401 on every request. Developers assume credentials or env are wrong, spend hours debugging the wrong hypothesis.

**Why it happens:** Every Basic Auth tutorial and helper library uses `username:password`. BPoint's pipe-separated `username|merchantnumber:password` is BPoint-specific and not obvious from the error response.

**How to avoid:** Encode explicitly and verify the decoded string contains a `|`:

```typescript
// Dev-only sanity check in a unit test or route handler
if (process.env.NODE_ENV !== "production") {
  const header = `${username}|${merchantNumber}:${password}`;
  if (!header.includes("|")) {
    throw new Error("[bpoint] auth header missing pipe separator");
  }
}
```

**Warning signs:**
- 401 with no field-level error detail
- Auth header built with `btoa(user + ":" + pass)` or standard libraries
- Merchant number passed separately as a header/body field instead of inline in auth

**Impact if missed:** Complete payment flow blocked. No AuthKey can be created.

### Pitfall 2: Amount as Float or Dollars Instead of Integer Cents

**What goes wrong:** Passing `1320` (dollars) or `1320.00` causes either rejection or a $13.20 charge — a 100× undercharge on urgent matters.

**Why it happens:** Mental model drift during the Stripe→BPoint swap. Stripe also uses cents, but if the developer hand-rolls the migration they may reach for a "cleaner" dollar representation.

**How to avoid:**
- Keep `PRICING.*.amount` in cents (it already is at `src/lib/stripe.ts:19,25`).
- Pass the value directly — no conversion.
- Optional runtime guard in `createAuthKey()`:

```typescript
if (!Number.isInteger(pricing.amount) || pricing.amount < 100) {
  throw new Error(`[bpoint] invalid amount: ${pricing.amount}`);
}
```

**Warning signs:**
- Decimal point anywhere in the `Amount` field value
- `* 100` conversion at any call site
- Changes to `PRICING` values during migration

**Impact if missed:** Firm loses $1,306.80 per urgent transaction. Smokeball invoice reconciliation fails.

### Pitfall 3: `IsTestTxn` Cached at Module Load (Leaks to Production)

**What goes wrong:** `BPOINT_ENV=prod` is set in Vercel production, but `IsTestTxn` resolves to `true` because the value was captured at bundle time in dev. All "successful" transactions appear in BPoint back office but never settle. Firm discovers zero revenue at bank reconciliation weeks later.

**Why it happens:** Developer writes `const IS_TEST = process.env.BPOINT_ENV !== "prod"` at module top. On Vercel's serverless build, this value is inlined at bundle time — often to the dev value.

**How to avoid:** Evaluate inside the function body on every call:

```typescript
// CORRECT — CONTEXT.md decision
export function createAuthKey(args: CreateAuthKeyArgs) {
  const isTestTxn = process.env.BPOINT_ENV !== "prod"; // read now, every call
  // ...
}
```

**Warning signs:**
- `const IS_TEST = ...` or `const BPOINT_ENV = ...` at the top of `bpoint.ts`
- Build logs showing `IsTestTxn: true` literal in the deployed bundle
- BPoint back office showing all "successful" transactions as test

**Impact if missed:** Zero revenue collection in production. Discovered days or weeks later. Manual re-charge of every affected client.

### Pitfall 4: Missing a Call Site During the Field Rename

**What goes wrong:** `tsc --noEmit` passes because some files use `(session as any).stripeSessionId` patterns, or a JSON.stringify of a legacy Redis record still emits the old key. Zapier's email parser doesn't find the expected row; Smokeball sync breaks silently.

**Why it happens:** Grep-driven rename misses type-inferred references (e.g., object destructuring with `...rest`) or dynamic property access.

**How to avoid:**
- **Complete rename surface** (from codebase grep on 2026-04-23):

  | File | Line(s) | Action |
  |------|---------|--------|
  | `src/types/index.ts` | 17 | Rename field in `SessionData` |
  | `src/lib/kv.ts` | 28 | Rename default in `createSession()` |
  | `src/lib/intake.ts` | 21, 31, 32, 38 | Rename field + `createIntake` args + default |
  | `src/lib/resend.ts` | 14, 23, 40, 139, 148, 183 | Rename param + HTML row label in 2 email functions |
  | `src/app/api/checkout/route.ts` | 22, 24 | Rename field assignment + log message |
  | `src/app/api/checkout/resume/route.ts` | 21, 23, 43 | Rename field reads + assignment (logic rewritten Phase 2) |
  | `src/app/api/webhooks/stripe/route.ts` | 47, 116, 121 | Rename field assignments OR no-op body (planner decides) |
  | `src/app/api/webhooks/calendly/route.ts` | 86 | Rename intake field read |
  | `src/scripts/revoke-upload-token.ts` | 5, 14 | Rename CLI flag help text |

- Run `npx tsc --noEmit` as the acceptance gate. Roadmap success criterion #3 is explicit: zero TS errors.
- Follow-up `grep -rn "stripeSessionId" src/` must return zero hits before committing.

**Warning signs:**
- Dynamic property access: `session["stripeSessionId"]`
- `as any` casts near the field
- Redis records in dev containing both keys

**Impact if missed:** TypeScript acceptance gate fails (roadmap SC#3). Zapier field mapping silently breaks DATA-02.

### Pitfall 5: `lineItem` String Drift During Pricing Extraction

**What goes wrong:** During the `PRICING` move from `stripe.ts` to `pricing.ts`, a well-meaning refactor "normalizes" the strings — e.g., `"Initial Deposit — Urgent Court Matter"` (em-dash instead of "for"). Smokeball invoice reconciliation breaks because Zapier parses the exact bytes.

**Why it happens:** Copy-paste fatigue or "clean-up" reflex. The `lineItem` values are domain constants, not labels.

**How to avoid:**
- Copy the object literal verbatim from `src/lib/stripe.ts:18-31`.
- Add a test or assertion: `expect(PRICING.urgent.lineItem).toBe("Initial Deposit for Urgent Court Matter")`. (Test infra in Validation Architecture section.)
- Pre-commit check: `grep -n 'Initial Deposit for Urgent Court Matter' src/lib/pricing.ts`.

**Warning signs:**
- Any edit to the string values during extraction
- Em-dash, en-dash, or smart-quote normalization diffs
- Word-order changes or tense changes

**Impact if missed:** Firm's Zapier→Smokeball automation silently corrupts invoices. Discovered at month-end reconciliation.

### Pitfall 6: BPoint Environment URL Mismatch (Sandbox vs UAT)

**What goes wrong:** The `.env.example` comment says BPoint offers a "sandbox" endpoint (`www.bpoint.com.au/webapi/sandbox`), while CONTEXT.md + prior research state the UAT endpoint is `bpoint.uat.linkly.com.au`. These are two different hostnames, and using the wrong one against your credentials returns opaque errors.

**Why it happens:** BPoint's v2/v3 docs and v5 docs use different environment naming. "Sandbox" is a v2 concept; "UAT" is the v5 / post-Linkly naming. Credentials issued for UAT do not work against the production-sandbox path and vice versa.

**How to avoid:**
- Default to `bpoint.uat.linkly.com.au` for `BPOINT_ENV !== "prod"` (aligns with CONTEXT.md decision).
- Document both URLs as constants in `bpoint.ts` with a comment referencing this pitfall.
- See Open Question 1 — planner may need firm to confirm which endpoint their UAT credentials target.

**Warning signs:**
- 404 or generic auth errors against one host but not the other
- Firm provides credentials without specifying which environment
- `.env.example` and CONTEXT.md disagree (they currently do — flag for Open Question 1)

**Impact if missed:** Cannot complete Phase 1 contract test (`curl POST /api/checkout → { authKey }`). Blocks Phase 2 kickoff.

## Code Examples

Verified patterns, adapted for Phase 1 scope:

### Example 1: Basic Auth helper with pipe separator (SESS-01)

```typescript
// Source: .planning/research/PITFALLS.md Pitfall 2, pipe-separator spec
function buildBpointAuthHeader(
  username: string,
  merchantNumber: string,
  password: string
): string {
  const raw = `${username}|${merchantNumber}:${password}`;
  return "Basic " + Buffer.from(raw).toString("base64");
}
```

### Example 2: Full `createAuthKey` with per-call env evaluation (SESS-01, SESS-02, SESS-03, SESS-04, SESS-05)

See "Architecture Patterns → Pattern 1" above for the full listing. Key call-site usage in `POST /api/checkout/route.ts`:

```typescript
// File: src/app/api/checkout/route.ts (Phase 1 target)
import { NextResponse } from "next/server";
import { PRICING } from "@/lib/pricing";
import { createAuthKey } from "@/lib/bpoint";
import { updateIntake } from "@/lib/intake";

export async function POST(req: Request) {
  const { sessionId, urgency } = (await req.json()) as {
    sessionId: string;
    urgency: "urgent" | "non-urgent";
  };

  if (!PRICING[urgency]) {
    return NextResponse.json({ error: "Invalid urgency" }, { status: 400 });
  }

  try {
    const authKey = await createAuthKey({
      sessionId,
      urgency,
      redirectionUrlBase: process.env.NEXT_PUBLIC_URL ?? "",
    });

    try {
      await updateIntake(sessionId, { bpointTxnNumber: authKey });
    } catch (err) {
      console.error("[checkout] failed to persist bpointTxnNumber to intake", err);
    }

    return NextResponse.json({ authKey });          // breaking change from { clientSecret }
  } catch (err) {
    console.error("[checkout] AuthKey creation failed", err);
    return NextResponse.json(
      { error: "Payment session could not be created" },
      { status: 502 }
    );
  }
}
```

### Example 3: Pricing extraction (DATA-03, SESS-03)

See "Architecture Patterns → Pattern 2" above — a direct verbatim move from `stripe.ts:18-33`.

### Example 4: Field rename pattern across Resend (DATA-01, DATA-02)

```typescript
// File: src/lib/resend.ts — targeted edits only; keep row position + HTML structure
export async function sendTranscriptEmail({
  clientName,
  clientEmail,
  clientPhone,
  matterDescription,
  urgency,
  paymentAmount,
  bpointTxnNumber,                                  // RENAMED — was stripeSessionId
  transcript,
}: {
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  matterDescription: string;
  urgency: string;
  paymentAmount: number;
  bpointTxnNumber: string | null;                   // RENAMED
  transcript?: string;
}) {
  // ... unchanged up to the payment identifier row ...
  return resend.emails.send({
    // ...
    html: `
      <h2>New Client Inquiry</h2>
      <table style="border-collapse:collapse;width:100%">
        <!-- rows above unchanged -->
        <tr>
          <td style="padding:8px;border:1px solid #ddd;font-weight:bold">BPoint Transaction</td>
          <td style="padding:8px;border:1px solid #ddd">${bpointTxnNumber ?? "N/A"}</td>
        </tr>
        <!-- NOTE: row position + <tr><td><td></tr> structure preserved for Zapier parser -->
      </table>
      ${transcript ? `<h3>Chat Transcript</h3>...` : ""}
    `,
  });
}
```

DATA-02 critical note: the row position in the table is a contract. Keep it as the last row before `</table>`, matching line 40 of the current file. Only the label text ("Stripe Session" → "BPoint Transaction") and the variable name change.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Stripe Embedded Checkout session (`checkout.sessions.create`) returning `client_secret` | BPoint `createAuthKey` returning `AuthKey` UUID | Phase 1 (this phase) | `POST /api/checkout` response shape changes; PaymentCard UI breaks until Phase 2. |
| Stripe HMAC-signed webhook events | BPoint redirect `ResultKey` + optional server-to-server callback (not signed) | Phase 2 / Phase 3 | Out of Phase 1 scope. Flagged so planner doesn't pre-build webhook verification here. |
| `stripeSessionId` across session/intake/email schemas | `bpointTxnNumber` | Phase 1 | Single hard rename, acceptance gate is `tsc --noEmit` clean. |
| `IsTestTxn` gated by `NODE_ENV` (Stripe test keys) | `IsTestTxn = process.env.BPOINT_ENV !== "prod"` | Phase 1 | Explicit opt-in for prod. Preview deploys stay in test mode. |

**Deprecated/outdated:**
- BPoint v2 API endpoints (e.g., `www.bpoint.com.au/webapi/v2`) are still live but v5 is the current documented version. This project targets v5 per CONTEXT.md external-references list. The actual REST path (`/webapi/v2/txns/authkey` vs `/v5/txn/authkey`) requires confirmation — see Open Question 2.
- `btoa(user + ":" + pass)` / standard Basic Auth — replaced with pipe-separated BPoint-specific format.
- Stripe package imports in `checkout/route.ts` — replaced by `bpoint.ts` imports. Stripe code stays on disk until Phase 3 (CLEAN-01..03).

## Open Questions

1. **BPoint non-prod endpoint: "sandbox" vs "UAT"?**
   - What we know: CONTEXT.md + prior research (`.planning/research/FEATURES.md`) specify `bpoint.uat.linkly.com.au` as the UAT base. `.env.example` comment (lines 27-32) mentions `www.bpoint.com.au/webapi/sandbox` and claims Aquarius's facility is "prod-only, no separate UAT environment" — recommending a $0.01-txn+refund smoke test.
   - What's unclear: Which endpoint do the firm's actual credentials target? Are UAT credentials even issued, or does the firm only have prod creds + expect `IsTestTxn: true` for dev?
   - Recommendation: Planner should add a task to confirm with the firm before Phase 1 integration testing. Default the `bpoint.ts` base URL to `bpoint.uat.linkly.com.au` per CONTEXT.md decision, but structure the code so the prod/non-prod URL pair is a single edit. If firm says "no UAT," flip the non-prod URL to production and rely solely on `IsTestTxn: true` (the STATE.md blocker about "UAT credentials required" suggests UAT is the assumed path).

2. **Exact BPoint v5 request path and body shape for `createAuthKey`.**
   - What we know: Prior research gives us `POST /v5/txn/authkey` with body fields `TxnType`, `Amount`, `Currency`/`CurrencyCode`, `Crn1`, `MerchantReference`, `RedirectionUrl` (ARCHITECTURE.md Pattern 1). v2 uses `/webapi/v2/txns/authkey` with a `TxnReq` envelope.
   - What's unclear: Whether the v5 path has changed or the body is flat vs wrapped in `TxnReq: { ... }`. Field-name casing (`Currency` vs `CurrencyCode`). Whether `SubType` / expiry fields are required for the 30-minute TTL or BPoint applies a default.
   - Recommendation: Planner writes the client to match the prior-research shape (`TxnReq` envelope, `CurrencyCode: "AUD"`). First curl against UAT will confirm — treat HTTP 400 responses as learning, not failure. If shape is wrong, iterate and re-test; do not block downstream tasks.

3. **Stripe webhook field references: update or no-op?**
   - What we know: CONTEXT.md explicitly leaves this to the planner (either is acceptable).
   - What's unclear: Whether the webhook still receives live events during Phase 1 (the Stripe account is still active, cards may still route to Stripe until Phase 2 + Phase 3 complete).
   - Recommendation: Update field references in-place (option a). It's a 3-line diff, keeps the webhook functional during the soak period in case a late Stripe callback arrives, and avoids dead code. Phase 3 deletes the whole file anyway.

4. **AuthKey 30-minute expiry: BPoint-side config or app-side enforcement?**
   - What we know: CONTEXT.md says "Configured at AuthKey-creation time against BPoint (matches existing Stripe `expires_at: Math.floor(Date.now() / 1000) + 30 * 60` pattern)."
   - What's unclear: Whether BPoint's AuthKey request body accepts an expiry field (unconfirmed in public docs) or defaults to a fixed value. If BPoint's default is ≤ 30 minutes, SESS-05 is trivially satisfied with no explicit field.
   - Recommendation: Attempt to include an expiry field in the first test request (e.g., `ExpiryInMinutes: 30` or similar — name TBD). If BPoint rejects with "unknown field," remove it and rely on BPoint's default; document in inline comment that expiry is implicit. The 30-minute TTL is what the *application* observes — as long as a fresh AuthKey is usable for at least 30 minutes, SESS-05 is met.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | **None currently installed** — recommend Vitest (per `.planning/codebase/TESTING.md`) |
| Config file | None — to be created in Wave 0 (`vitest.config.ts`) |
| Quick run command | `npx vitest run --reporter=dot` (once installed) |
| Full suite command | `npx vitest run` (once installed) |

**Fallback if Wave 0 does not add Vitest:** Use **contract curl tests + `npx tsc --noEmit`** as the automated Phase 1 gate. This is faithful to the project's current zero-test-infra state and fully covers the roadmap success criteria.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| SESS-01 | Basic Auth header includes pipe separator | unit | `npx vitest run src/lib/bpoint.test.ts -t "auth header"` | Wave 0 |
| SESS-01 | `BPOINT_API_USERNAME` missing throws descriptive error | unit | `npx vitest run src/lib/bpoint.test.ts -t "env guard"` | Wave 0 |
| SESS-02 | `POST /api/checkout` returns `{ authKey: string }` (UUID shape) | integration (contract) | `curl -X POST http://localhost:3000/api/checkout -H 'Content-Type: application/json' -d '{"sessionId":"test-uuid","urgency":"urgent"}' \| jq -e '.authKey \| test("^[0-9a-f-]{36}$")'` | Manual during integration; automatable via `vitest` with `msw` in Wave 0 |
| SESS-02 | Request body includes `Amount`, `Crn1`, `RedirectionUrl`, `CurrencyCode: "AUD"` | unit (mock fetch) | `npx vitest run src/lib/bpoint.test.ts -t "request body"` | Wave 0 |
| SESS-03 | `PRICING.urgent.lineItem === "Initial Deposit for Urgent Court Matter"` | unit | `npx vitest run src/lib/pricing.test.ts -t "lineItem strings"` | Wave 0 |
| SESS-03 | `PRICING.urgent.amount === 132000 && PRICING["non-urgent"].amount === 72600` | unit | `npx vitest run src/lib/pricing.test.ts -t "amounts in cents"` | Wave 0 |
| SESS-04 | `IsTestTxn` is `false` only when `BPOINT_ENV === "prod"` | unit (env mocking) | `npx vitest run src/lib/bpoint.test.ts -t "IsTestTxn gating"` | Wave 0 |
| SESS-04 | `IsTestTxn` is evaluated per-call (not cached) | unit (env toggle mid-test) | `npx vitest run src/lib/bpoint.test.ts -t "per-call env evaluation"` | Wave 0 |
| SESS-05 | AuthKey request body encodes 30-minute expiry OR BPoint default ≤ 30min | integration | Manual UAT smoke: create AuthKey, wait 31min, attempt use, assert rejection. Automatable as `vitest` integration test if BPoint provides a poll endpoint. | Wave 0 / Phase 4 |
| DATA-01 | No `stripeSessionId` references remain in `src/` | static | `! grep -rn "stripeSessionId" src/` (exit 0 when clean) | Exists (grep) |
| DATA-01 | TypeScript compiles cleanly after rename | static | `npx tsc --noEmit` | Exists |
| DATA-02 | Transcript email HTML contains `BPoint Transaction` row (not `Stripe Session`) | unit (snapshot or string match) | `npx vitest run src/lib/resend.test.ts -t "transcript row label"` | Wave 0 |
| DATA-02 | Transcript email table has the same number of rows as before the rename | unit (count `<tr>` occurrences) | `npx vitest run src/lib/resend.test.ts -t "row count stable"` | Wave 0 |
| DATA-03 | `paymentAmount` in `SessionData` remains `number` (integer cents) | static | `npx tsc --noEmit` (type unchanged) | Exists |

### Sampling Rate

- **Per task commit:** `npx tsc --noEmit && ! grep -rn "stripeSessionId" src/` — 5-second static gate.
- **Per wave merge:** `npx vitest run --reporter=dot` (unit + contract tests) + the full curl contract test against local dev server.
- **Phase gate:** Full suite green + one real curl against a live BPoint UAT endpoint returning a valid AuthKey UUID (or, if UAT creds unavailable, a live-mocked response via `msw`).

### Wave 0 Gaps

- [ ] `package.json` — add `vitest@^1`, `@vitest/ui`, `msw@^2` as devDependencies; add `test` + `test:watch` scripts
- [ ] `vitest.config.ts` — Node environment, `@/` alias matching `tsconfig.json`
- [ ] `src/lib/pricing.test.ts` — asserts verbatim `lineItem` strings and integer-cent amounts (covers SESS-03, DATA-03)
- [ ] `src/lib/bpoint.test.ts` — covers SESS-01, SESS-02 (request shape via `msw`), SESS-04 (env toggling)
- [ ] `src/lib/resend.test.ts` — covers DATA-02 (row label + structure)
- [ ] `tests/contract/checkout.sh` (or equivalent Vitest) — curl-based end-to-end contract test for `POST /api/checkout` (covers roadmap SC#1)
- [ ] `vitest.setup.ts` — reset `process.env.BPOINT_ENV` before each test to prevent cross-test pollution

*If the team decides against introducing Vitest in Phase 1, Wave 0 reduces to: a bash script at `tests/contract/checkout.sh` doing the curl+jq assertion, plus `npx tsc --noEmit` and `grep -rn stripeSessionId src/` as the acceptance gates. This is minimally sufficient for all Phase 1 success criteria except SESS-01 dev-time auth header verification, which can be a one-off `console.log` guarded by `NODE_ENV !== "production"`.*

## Sources

### Primary (HIGH confidence)

- **Codebase — `src/lib/stripe.ts:1-65`** — `getStripe()` pattern, `PRICING` constant, `createCheckoutSession` shape with 30-min TTL literal
- **Codebase — `src/types/index.ts:8-21`** — `SessionData` with `stripeSessionId: string | null` (rename target)
- **Codebase — `src/lib/kv.ts:15-36`** — `createSession` default-object pattern
- **Codebase — `src/lib/intake.ts:12-44`** — `IntakeRecord` and `createIntake` partial
- **Codebase — `src/lib/resend.ts:7-46,133-190`** — `sendTranscriptEmail` and `sendBookingNotificationEmail` HTML structure (Zapier contract surface)
- **Codebase — `src/app/api/checkout/route.ts:1-28`** — current handler pattern to preserve
- **CONTEXT.md** (`.planning/phases/01-foundation/01-CONTEXT.md`) — locked decisions on rename strategy, env gating, response shape, pricing module location
- **REQUIREMENTS.md** (`.planning/REQUIREMENTS.md`) — SESS-01..05, DATA-01..03 definitions
- **ROADMAP.md** §Phase 1 — five success criteria (acceptance gates)
- **`.env.example`** — confirms env var names `BPOINT_API_USERNAME`, `BPOINT_API_PASSWORD`, `BPOINT_MERCHANT_NUMBER`, `BPOINT_BILLER_CODE`, `BPOINT_ENV`; flags sandbox-vs-UAT ambiguity (Open Question 1)

### Secondary (MEDIUM confidence)

- **`.planning/research/ARCHITECTURE.md`** — AuthKey-then-iframe flow, request body fields (`TxnType`, `Amount`, `Crn1`, `CurrencyCode`, `MerchantReference`, `RedirectionUrl`), response includes `AuthKey` UUID
- **`.planning/research/FEATURES.md`** — BPoint v5 capability map, Stripe↔BPoint replacement table, UAT endpoint `bpoint.uat.linkly.com.au`
- **`.planning/research/PITFALLS.md`** — pitfalls 1–3 (auth header, amount cents, IsTestTxn) are the backbone of this document's pitfalls section
- **`.planning/codebase/CONVENTIONS.md`, `STRUCTURE.md`, `INTEGRATIONS.md`** — naming conventions, lazy-singleton pattern, env var canon
- [BPoint v5 Transaction AuthKey](https://www.bpoint.com.au/developers/v5/api/txn/authkey) — official reference (React SPA, partial indexing)
- [BPoint v5 Token AuthKey](https://www.bpoint.com.au/developers/v5/api/token/authkey) — tokenisation variant (not this phase)
- [BPoint v5 Authentication](https://www.bpoint.com.au/developers/v5/api/txn/authkey/authentication) — confirms pipe-separated auth format
- [BPoint UAT environment](https://bpoint.uat.linkly.com.au/developers/v5/api/spec) — UAT endpoint host confirmation
- [Spreedly BPoint Gateway Guide](https://docs.spreedly.com/payment-gateways/bpoint/) — operation list, test-mode notes
- [BPoint Test Mode](https://www.bpoint.com.au/developers/v5/reference/test-mode) — IsTestTxn flag semantics

### Tertiary (LOW confidence — flagged as Open Questions)

- Exact v5 request path (`/v5/txn/authkey` vs `/webapi/v2/txns/authkey`) — partial docs, requires first live test
- AuthKey expiry field name and default (Open Question 4)
- "Sandbox" vs "UAT" endpoint clarity for Aquarius's specific facility (Open Question 1)

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — all tools are native Node or already in `package.json`
- Architecture: **HIGH** — patterns are explicit in CONTEXT.md and codebase; `bpoint.ts` mirrors `stripe.ts`
- Pitfalls: **HIGH** — sourced from prior project research with direct citations
- BPoint API specifics (request body shape): **MEDIUM** — v5 docs are React SPAs; first live UAT call may refine request body
- Sandbox/UAT endpoint choice: **LOW** — contradictory signals between CONTEXT.md and `.env.example`; flagged as Open Question 1
- Validation architecture: **MEDIUM** — recommendation depends on whether the team chooses to install Vitest in Wave 0

**Research date:** 2026-04-23
**Valid until:** 2026-05-23 (stable codebase context); 2026-05-07 for BPoint-API claims (fast-moving, revalidate against first live UAT response)
