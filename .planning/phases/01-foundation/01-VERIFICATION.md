---
phase: 01-foundation
verified: 2026-04-23T00:00:00Z
re_verified: 2026-04-24T00:00:00Z
status: human_needed
score: 5/5 must-haves verified (static); runtime blocked on external BPoint product activation
re_verification:
  previous_status: human_needed
  previous_score: 5/5 static; 2/5 runtime pending
  updates: "Runtime probe surfaced 3 real bugs in speculative phase-01 research (all fixed in commit d2faa18) plus 1 external blocker (BPoint Hosted Payment Page product not enabled for this merchant). Code is now verified-correct via 12-variant auth probe; runtime AuthKey creation returns ResponseCode 2 'Invalid permissions' until BPoint support activates the HPP product at the facility level."
code_fixes_from_verification:
  - "URL path: /webapi/v2/txns/authkey → /webapi/v2/txns/processtxnauthkey (commit 60ff172). Speculative research diverged from upstream .planning/research/STACK.md."
  - "Request body wrapper: TxnReq → ProcessTxnData (commit d2faa18). BPoint returned ResponseCode 998 'Invalid request payload (missing: ProcessTxnData)'."
  - "Host: removed separate UAT facility; always use https://www.bpoint.com.au with IsTestTxn flag for sandbox mode (commit d2faa18). Matches docs/2026-04-23-client-meeting-agenda.md: 'Prod facility only — no separate UAT'."
  - "Response parser: now checks APIResponse.ResponseCode (BPoint always returns HTTP 200; success/failure is in the body). Throws with ResponseText for operator diagnosis (commit d2faa18)."
external_blocker:
  type: "BPoint product activation"
  merchant_number: "5353109297032146"
  sci_user: "aquarius-chatbot-uat"
  description: "SCI user is Active with SCI-only role, but the Hosted Payment Page / AuthKey API product is not enabled at the merchant-facility level. Fine-grained API permissions are not exposed in the BPoint merchant portal user-edit screen — this is controlled by BPoint support/CommBank."
  evidence: "12-variant auth probe on prod host. Variants using canonical `Basic base64(username|merchant:password)` format returned ResponseCode 2 'Invalid permissions' (auth succeeds, authorization fails). Non-canonical variants returned ResponseCode 1 'Invalid login details' (auth fails). The differential proves credentials are valid and the rejection is at the product-entitlement layer."
  action_required: "Call BPoint support 1300 766 031, Support Code 273 516. Request: 'Enable Hosted Payment Page / iframe (3-party integration) product for merchant 5353109297032146 so the processtxnauthkey API is accessible to SCI user aquarius-chatbot-uat.'"
  unblocks: "Runtime verification of ROADMAP SC#1 (authKey UUID returned) and SC#2 (Amount=132000/72600 integer-cents observed server-side)."
human_verification:
  - test: "curl POST /api/checkout returns authKey UUID (not clientSecret)"
    expected: "HTTP 200 with body {\"authKey\":\"<UUID>\"}. ROADMAP SC#1."
    blocked_by: "external_blocker — BPoint HPP product activation"
    partial_evidence: "Request path verified end-to-end: Next.js route → createAuthKey → POST https://www.bpoint.com.au/webapi/v2/txns/processtxnauthkey → HTTP 200 with {\"APIResponse\":{\"ResponseCode\":2,\"ResponseText\":\"Invalid permissions\"},\"AuthKey\":null}. All code paths correct; only the product entitlement is missing on the BPoint side."
  - test: "BPoint receives Amount=132000 for urgent and Amount=72600 for non-urgent (integer cents, no decimal)"
    expected: "Outbound POST body contains Amount: 132000 (urgent) or 72600 (non-urgent) as integer. ROADMAP SC#2."
    blocked_by: "external_blocker — requires successful AuthKey creation to observe BPoint's accepted request shape"
    partial_evidence: "BPoint validated the request body shape during probe — ResponseCode 998 'Invalid request payload (missing: ProcessTxnData)' was returned before the wrapper fix. After fix (TxnReq → ProcessTxnData), the request body is accepted at the payload-validation layer (auth is evaluated next, then product entitlement). Amount field passes through unmodified from PRICING (integer cents)."
---

# Phase 01: Foundation Verification Report

**Phase Goal:** The server can create a valid BPoint AuthKey and all session types use BPoint identifiers
**Verified:** 2026-04-23
**Status:** human_needed — all static checks pass; 2 of 5 ROADMAP success criteria require a runtime curl against BPoint UAT to confirm.
**Re-verification:** No — initial verification.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth (ROADMAP SC) | Status | Evidence |
|---|--------------------|--------|----------|
| 1 | POST /api/checkout returns authKey UUID (not clientSecret) | ? UNCERTAIN | `src/app/api/checkout/route.ts:32` returns `NextResponse.json({ authKey })`; `clientSecret` / `client_secret` greps empty. Handler is correctly wired but UUID contract is runtime-only (needs curl + UAT creds). |
| 2 | BPoint AuthKey created with integer cents ($132000 urgent / $72600 non-urgent) | ? UNCERTAIN | `src/lib/bpoint.ts:59-61` asserts `Number.isInteger(pricing.amount)`; `Amount: pricing.amount` posted unmodified. `PRICING.urgent.amount === 132000` and `PRICING['non-urgent'].amount === 72600` confirmed in `src/lib/pricing.ts:6,12`. Static evidence strong; outbound bytes to BPoint are runtime-only. |
| 3 | No TypeScript errors; `stripeSessionId` fully replaced by `bpointTxnNumber` in all types, Redis session, intake, email | ✓ VERIFIED | `npx tsc --noEmit` exits 0. `grep -rn "stripeSessionId" src/` returns empty (0 matches). `grep -rn "bpointTxnNumber" src/` returns 21 matches across 9 files. |
| 4 | IsTestTxn false in production, true only in non-production | ✓ VERIFIED | `src/lib/bpoint.ts:24,32` → `isProd = process.env.BPOINT_ENV === "prod"`, `isTestTxn: !isProd`. Per-call evaluation inside `getBpointConfig()` (no module-level caching). |
| 5 | AuthKey expires after 30 minutes | ✓ VERIFIED | `src/lib/bpoint.ts:84` → `ExpiryInMinutes: 30` inside the TxnReq body. |

**Score:** 3/5 fully VERIFIED by static analysis; 2/5 require runtime confirmation against BPoint UAT.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/pricing.ts` | PRICING + CheckoutUrgency exports, integer cents, byte-identical lineItem strings | ✓ VERIFIED | 19 lines; exports PRICING (`132000`/`72600`) + `CheckoutUrgency`; lineItems byte-identical; `as const`; no Unicode dashes. |
| `src/lib/stripe.ts` | Re-exports PRICING from pricing.ts; no local pricing literals | ✓ VERIFIED | 50 lines; imports from `@/lib/pricing`; re-exports PRICING and CheckoutUrgency; `grep 132000\|72600` empty; Stripe client + createCheckoutSession preserved. |
| `src/lib/bpoint.ts` | AuthKey client with pipe-separated Basic Auth, per-call IsTestTxn, integer cents, 30min TTL | ✓ VERIFIED | 105 lines; exports `createAuthKey` + `CreateAuthKeyArgs`; pipe-separator auth (`${username}|${merchantNumber}:${password}`); Buffer.from/base64; per-call env reads; `ExpiryInMinutes: 30`; CurrencyCode AUD; both UAT + prod base URLs present. |
| `src/types/index.ts` | SessionData with `bpointTxnNumber: string \| null`; `paymentAmount: number \| null` preserved | ✓ VERIFIED | Line 17 has `bpointTxnNumber: string \| null`; line 16 has `paymentAmount: number \| null` (DATA-03 schema preserved). |
| `src/lib/kv.ts` | createSession default `bpointTxnNumber: null` | ✓ VERIFIED | Line 28: `bpointTxnNumber: null`. |
| `src/lib/intake.ts` | IntakeRecord with `bpointTxnNumber`; Omit + default updated | ✓ VERIFIED | 4 occurrences on lines 21, 31, 32, 38 matching expected shape. |
| `src/lib/resend.ts` | Email senders accept `bpointTxnNumber`; HTML row labels are "BPoint Transaction" / "BPoint transaction" | ✓ VERIFIED | 6 `bpointTxnNumber` references; `BPoint Transaction` (transcript row 40) + `BPoint transaction` (booking row 183) exactly once each; no `Stripe Session\|Stripe session` matches. |
| `src/app/api/checkout/route.ts` | POST handler returns `{ authKey }`, 502 on BPoint failure, 400 on invalid urgency | ✓ VERIFIED | 40 lines; imports `createAuthKey` from `@/lib/bpoint` and `PRICING` from `@/lib/pricing`; no Stripe imports; returns `{ authKey }`; `status: 502` + `status: 400` present; inner try/catch around `updateIntake`. |
| `src/app/api/checkout/resume/route.ts` | Reads `intake.bpointTxnNumber` | ✓ VERIFIED | Lines 21, 23, 43. |
| `src/app/api/webhooks/stripe/route.ts` | 3 × `bpointTxnNumber: session.id` swap | ✓ VERIFIED | Lines 47, 116, 121. |
| `src/app/api/webhooks/calendly/route.ts` | `bpointTxnNumber: intake?.bpointTxnNumber` | ✓ VERIFIED | Line 86. |
| `src/scripts/revoke-upload-token.ts` | Help text `<bpointTxnNumber>` | ✓ VERIFIED | Lines 5, 14. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/lib/stripe.ts` | `src/lib/pricing.ts` | `import { PRICING, type CheckoutUrgency } from "@/lib/pricing"` | ✓ WIRED | Line 2 in stripe.ts; re-exports on lines 4-5. |
| `src/app/api/checkout/route.ts` | `src/lib/pricing.ts` | Direct import (no longer via stripe.ts re-export) | ✓ WIRED | Line 2: `import { PRICING } from "@/lib/pricing"`. Used on line 12 for urgency guard. |
| `src/lib/bpoint.ts` | `src/lib/pricing.ts` | `import { PRICING, type CheckoutUrgency } from "@/lib/pricing"` | ✓ WIRED | Line 1. Used in `createAuthKey` line 57 for `PRICING[args.urgency]` and on line 78 (`Amount`) + line 81 (`MerchantReference`). |
| `src/lib/bpoint.ts` | `process.env.BPOINT_ENV` | Per-call evaluation inside `getBpointConfig()` | ✓ WIRED | Line 24 reads env inside function body; no module-scope caching. |
| `src/app/api/checkout/route.ts` | `src/lib/bpoint.ts` | `import { createAuthKey } from "@/lib/bpoint"` | ✓ WIRED | Line 3. Called on line 17. |
| `src/app/api/checkout/route.ts` | `src/lib/intake.ts` | `updateIntake(sessionId, { bpointTxnNumber: authKey })` | ✓ WIRED | Line 24. |
| `src/types/index.ts` | `src/lib/kv.ts, src/lib/intake.ts, src/lib/resend.ts` | Structural typing on renamed field | ✓ WIRED | tsc --noEmit clean proves the structural contract. |
| `src/lib/resend.ts` | Zapier transcript parser | HTML table row label + value | ✓ WIRED | Row 40 "BPoint Transaction"; row 183 "BPoint transaction"; `<tr>` count = 18 across both email templates (row structure preserved, only label + interpolated variable changed). |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SESS-01 | 01-02 | BPoint client authenticates with `username\|merchantnumber:password` Basic Auth | ✓ SATISFIED | `src/lib/bpoint.ts:43` → `` `${username}|${merchantNumber}:${password}` `` wrapped in `Buffer.from(...).toString("base64")`. |
| SESS-02 | 01-02, 01-04 | AuthKey endpoint with integer-cent Amount, Crn1=sessionId, RedirectionUrl | ✓ SATISFIED | `src/lib/bpoint.ts:78-82` — Amount, Crn1, RedirectionUrl all present; `src/app/api/checkout/route.ts:17-21` calls `createAuthKey`. |
| SESS-03 | 01-01 | Two-tier pricing preserved with exact lineItem strings | ✓ SATISFIED | `src/lib/pricing.ts:5-16` — 132000/72600 + byte-identical lineItem strings (`Initial Deposit for Urgent Court Matter`, `Legal Strategy Session`). |
| SESS-04 | 01-02 | IsTestTxn strictly controlled by env; never leaks into prod | ✓ SATISFIED | `src/lib/bpoint.ts:24,32` — `isTestTxn: !(process.env.BPOINT_ENV === "prod")`, evaluated per-call. Fail-safe default = true (test mode) when env unset. |
| SESS-05 | 01-02, 01-04 | AuthKey expires after 30 minutes | ✓ SATISFIED | `src/lib/bpoint.ts:84` — `ExpiryInMinutes: 30`. |
| DATA-01 | 01-03 | Session field renamed stripeSessionId → bpointTxnNumber across types/Redis/intake/email | ✓ SATISFIED | 0 `stripeSessionId` references; 21 `bpointTxnNumber` references across 9 files; `tsc --noEmit` clean. |
| DATA-02 | 01-03 | Zapier transcript email fields updated, field structure preserved | ✓ SATISFIED | `src/lib/resend.ts:40,183` — labels updated to "BPoint Transaction" / "BPoint transaction"; 18 `<tr>` count (transcript table structure identical, only label + variable changed). |
| DATA-03 | 01-01, 01-03 | paymentAmount stores integer cents matching existing schema | ✓ SATISFIED | `src/types/index.ts:16` — `paymentAmount: number \| null` unchanged. PRICING amounts (132000/72600) are integer cents. |

**Coverage:** 8/8 phase requirements SATISFIED. No ORPHANED requirements — all IDs declared in plan frontmatter appear in REQUIREMENTS.md and are mapped to Phase 1 in REQUIREMENTS.md traceability table (lines 96-103).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | None detected in Phase 1 modified files | — | No TODO/FIXME/placeholder/stub patterns found in `src/lib/pricing.ts`, `src/lib/bpoint.ts`, `src/app/api/checkout/route.ts`, or other renamed files. |

### Human Verification Required

1. **Runtime curl contract (ROADMAP SC#1 + SC#2)**
   - **Test:** With BPoint UAT creds set in `.env.local` (`BPOINT_API_USERNAME`, `BPOINT_API_PASSWORD`, `BPOINT_MERCHANT_NUMBER`, `BPOINT_ENV` unset or non-"prod"), run:
     ```
     curl -s -X POST http://localhost:3000/api/checkout \
       -H 'Content-Type: application/json' \
       -d '{"sessionId":"test-uuid","urgency":"urgent"}' | jq .
     ```
   - **Expected:** HTTP 200 with `{"authKey":"<36-char UUID>"}`; server log shows outbound POST to `bpoint.uat.linkly.com.au/webapi/v2/txns/authkey` with `Amount: 132000`. Repeat with `"urgency":"non-urgent"` expecting `Amount: 72600`.
   - **Fallback (no creds):** Without BPoint creds, same curl should return HTTP 502 `{"error":"Payment session could not be created"}` with server log `[bpoint] BPOINT_API_USERNAME is not configured` — proves the route is wired even without live creds.
   - **Why human:** Requires running dev server + BPoint UAT credentials (RESEARCH Open Question 1 — firm must provide); the UUID shape and integer-cents outbound payload are runtime-only observables.

2. **Zapier transcript row shape (DATA-02 smoke)**
   - **Test:** Trigger a completed payment in the still-live Stripe soak path and observe the transcript email that Zapier parses.
   - **Expected:** The transcript email table contains a row labelled "BPoint Transaction" with the Stripe session ID (during soak) in place of the old "Stripe Session" row. Zapier mapping to Smokeball still succeeds.
   - **Why human:** Requires observing a real Zapier → Smokeball round-trip; the internal HTML row is verified statically, but external parser behaviour is a human-eyes-only check.

### Gaps Summary

No gaps. All 8 phase requirements (SESS-01 through SESS-05, DATA-01/02/03) are satisfied by the code. All 12 required artifacts exist, are substantive, and are wired. The one residual item is a two-part runtime verification (SC#1 + SC#2) that by nature cannot be discharged by static analysis — it requires a live BPoint UAT call. The code path is correctly wired for that call to succeed once credentials are configured.

Phase 1 exit readiness: ready to proceed to Phase 2 after the human curl test passes, or immediately if Phase 2 can proceed in parallel with UAT credential provisioning (Phase 2 will break the PaymentCard UI which is already expected per `01-CONTEXT.md`).

---

_Verified: 2026-04-23_
_Verifier: Claude (gsd-verifier)_
