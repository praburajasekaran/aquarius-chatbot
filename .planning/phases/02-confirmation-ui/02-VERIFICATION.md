---
phase: 02-confirmation-ui
verified: 2026-04-24T10:20:00Z
status: human_needed
score: 4/5 observable truths verified automatically (truth 1 iframe-render blocked by Phase-01 external dependency)
re_verification:
  previous_status: null
  previous_score: null
  gaps_closed: []
  gaps_remaining: []
  regressions: []
external_blocker:
  carried_from: 01-foundation
  source: .planning/phases/01-foundation/01-VERIFICATION.md
  description: "BPoint Hosted Payment Page product not activated at merchant-facility level. createAuthKey returns APIResponse.ResponseCode 2 'Invalid permissions' (credentials valid; entitlement missing) until BPoint support enables HPP for merchant 5353109297032146."
  impact_on_phase_02: "Blocks only live iframe-content render (truth 1 acceptance) and any live end-to-end payment. Does NOT block phase-02 code correctness — request path, CSP, URL construction, failure UI, and confirm-route flow are all statically verified + unit-tested."
  action_required_external: "Call BPoint support 1300 766 031, Support Code 273 516. Request enablement of Hosted Payment Page / iframe (3-party integration) product for merchant 5353109297032146 against SCI user aquarius-chatbot-uat."
observations_not_gaps:
  - type: "pre_existing_bug_out_of_scope"
    location: "src/components/chat/message-list.tsx:204"
    code: "urgency={part.input?.urgency ?? \"non-urgent\"}"
    git_blame_commit: "427456f"
    introduced_phase: "pre-Phase-01"
    risk: "Silent misbilling — if LLM emits tool call without urgency field, PaymentCard defaults to non-urgent ($726) even when user selected urgent ($1,320)."
    disposition: "NOT a phase-02 gap. Already spawned as a separate background task (tracked in 02-04-SUMMARY.md under 'Issues Encountered')."
human_verification:
  - test: "Live BPoint iframe content render"
    expected: "After POST /api/checkout succeeds (i.e. BPoint HPP activated), the iframe src=https://www.bpoint.com.au/webapi/v2/txns/iframe/{authKey} renders a visible BPoint card-entry form in the chat with zero CSP console violations."
    why_human: "Requires live BPoint facility with HPP product enabled. 3 of 4 PaymentCard UI sub-checks already passed on dev server (expired, declined, invalid, system, URL-clear, Start again). Only the iframe DOM-render sub-check cannot be exercised until the external blocker is lifted."
    blocker: "external — Phase-01 carried-forward; see external_blocker above."
  - test: "End-to-end payment smoke test"
    expected: "Client enters card in iframe, browser redirects to /api/checkout/confirm?ResultKey=..., server calls retrieveTransaction, SETNX succeeds, handleConfirmedPayment fan-out runs (session updated, upload token minted, receipt email sent, transcript email sent to firm), user redirected to /?payment=success, chat-widget clears URL and advances conversation."
    why_human: "Requires live BPoint UAT + live Resend + live Zapier/Smokeball. Planned formally as Phase 4 UAT work. Confirm-route unit tests cover the server-side flow; a live transaction exercises the request boundaries."
    blocker: "external — Phase-01 BPoint HPP activation + Phase-4 UAT scope."
---

# Phase 2: Confirmation & UI — Verification Report

**Phase Goal:** Clients can enter card details in the embedded BPoint iframe and payment confirmation is verified server-side.
**Verified:** 2026-04-24T10:20:00Z
**Status:** human_needed
**Re-verification:** No — initial verification.

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | PaymentCard renders a BPoint iframe (not Stripe EmbeddedCheckout); card entry form is visible in chat | ? HUMAN (code VERIFIED, live render BLOCKED by external) | `src/components/payment/payment-card.tsx:164-170` renders `<iframe src={bpointIframeUrl(authKey)} title="Secure card payment" />`. No `@stripe/*` imports remain in payment-card.tsx / chat-widget.tsx / message-list.tsx (grep returned zero hits). Unit test `tests/payment-card.test.tsx` Test 1 pins URL format and Test 2 asserts EmbeddedCheckoutProvider is absent. **Live render blocked on BPoint HPP activation (external).** |
| 2 | Browser is redirected to /api/checkout/confirm with ResultKey; server verifies transaction via BPoint before marking paid | ✓ VERIFIED | `src/app/api/checkout/confirm/route.ts` exports GET handler that: (a) parses `ResultKey` (defensive casing line 55), (b) early-exits on missing or `ResponseCode!=0`, (c) calls `retrieveTransaction(resultKey)` (line 71), (d) enforces dual gate `apiOk && TxnResp?.Approved === true` (lines 81-82). `retrieveTransaction` in `src/lib/bpoint.ts:143-161` hits `${cfg.baseUrl}/txns/${resultKey}` with Basic Auth. 8/8 confirm-route tests GREEN. |
| 3 | Successful payment triggers fan-out: upload token, receipt email, transcript email | ✓ VERIFIED | `src/lib/payments/handleConfirmedPayment.ts` executes in order: `getIntake` (throws on null) → `updateSession(paid)` → `createUploadToken` → dedup-key upgrade to `hashToken(rawToken)` → `resend.emails.send(PaymentReceipt)` → `sendTranscriptEmail(bpointTxnNumber)`. Confirm route calls it at `route.ts:115-119` inside try/catch. 5/5 handle-confirmed-payment tests GREEN. |
| 4 | Declined / invalid card shows human-readable failure (not raw BPoint response code) | ✓ VERIFIED | `src/lib/payments/bucket-bank-code.ts` maps `BankResponseCode` → `declined` / `invalid` / `system` (unknown defaults to `system`). Confirm route uses mapper at `route.ts:86` to build `?payment=failed&reason={bucket}`. PaymentCard's `FAILURE_COPY` record in `payment-card.tsx:20-25` renders the locked user-facing strings ("Card declined — please try another card.", etc.). 15/15 bucket tests + 4/4 payment-card tests + 6/6 chat-widget URL-signal tests GREEN. Raw `BankResponseCode` never reaches the UI (grep: only present in mapper source file). |
| 5 | Expired AuthKey allows retry; UI handles expiry gracefully | ✓ VERIFIED | `PaymentCard` seeds `useState<Status>(failureReason ?? "loading")` (line 42) so `?payment=failed&reason=expired` shows expiry UI without flashing loading. "Start again" button (`payment-card.tsx:143-150`) invokes `handleStartAgain` which calls `onRetryRequested?.()` then re-runs `fetchAuthKey()` (fresh POST /api/checkout). Chat-widget's `handleRetryRequested` clears `paymentFailureReason` state. `payment-card.test.tsx` Tests 3+4 verify the full cycle. Operator confirmed in 02-04 human-verify checkpoint on dev server. |

**Score:** 4/5 truths automatically VERIFIED; 1/5 has code verified + unit-tested but requires live BPoint render (external blocker).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/bpoint.ts` (+ retrieveTransaction, BPointTxnResp, BPointTxnResponse) | Appended exports alongside existing createAuthKey | ✓ VERIFIED | `retrieveTransaction` exported at line 143; types at lines 129-141. `createAuthKey` preserved (line 54). URL: `${cfg.baseUrl}/txns/${resultKey}` using existing `getBpointConfig` + `buildBpointAuthHeader`. Error string matches test regex. |
| `src/lib/payments/bucket-bank-code.ts` | New file with `bucketBankCode` + `FailureBucket` | ✓ VERIFIED | 38 lines, exports `FailureBucket` union + `bucketBankCode`. All 8 declined codes (05/51/54/57/61/62/65/91) and 4 invalid codes (14/55/82/N7) present. Unknown defaults to `system`. |
| `src/lib/payments/handleConfirmedPayment.ts` | Shared fan-out helper | ✓ VERIFIED | 107 lines, exports `handleConfirmedPayment` + `HandleConfirmedPaymentArgs`. All 7 required imports present (kv, intake, upload-tokens, resend, assert-no-tracking, payment-receipt, branding). Log tag `[payments]`. |
| `src/app/api/checkout/confirm/route.ts` | GET handler for BPoint redirect landing | ✓ VERIFIED | 131 lines, exports `GET`. All 4 required imports present (bpoint, kv, handleConfirmedPayment, bucket-bank-code). Dual-verification gate, SETNX `bpoint-txn:{TxnNumber}` with 7-day TTL, fan-out try/catch isolation. Log tag `[bpoint-confirm]`. |
| `src/components/payment/payment-card.tsx` | BPoint iframe + 4-bucket failure UI + Start again | ✓ VERIFIED | Zero Stripe imports (grep). Iframe at lines 164-170 uses `bpointIframeUrl(authKey)`. `FAILURE_COPY` Record with all 4 bucket strings. `handleStartAgain` re-fetches /api/checkout. |
| `src/components/chat/chat-widget.tsx` | URL-param reader + replaceState clear | ✓ VERIFIED | `useEffect` at lines 49-78 reads `?payment=success` → `handlePaymentComplete(latestPaymentToolCallId)` (Strategy B toolCallId scan) and `?payment=failed&reason=...` → `setPaymentFailureReason`, then `window.history.replaceState` clears URL. Unknown reason falls back to `"system"` (line 73). |
| `next.config.ts` | CSP frame-src for BPoint | ✓ VERIFIED | Line 13: `"Content-Security-Policy"` = `"frame-ancestors *; frame-src https://www.bpoint.com.au"`. Single header with semicolon separator (avoids browser most-restrictive intersection). |
| `tests/*` | 40/40 GREEN | ✓ VERIFIED | `npx vitest run` → "Test Files 6 passed (6), Tests 40 passed (40)" in 927ms. Zero failures, zero parse errors. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/app/api/checkout/confirm/route.ts` | `src/lib/bpoint.ts retrieveTransaction` | import | ✓ WIRED | `import { retrieveTransaction } from "@/lib/bpoint"` (line 3); called at line 71. |
| `src/app/api/checkout/confirm/route.ts` | `src/lib/payments/handleConfirmedPayment.ts` | import | ✓ WIRED | `import { handleConfirmedPayment } from "@/lib/payments/handleConfirmedPayment"` (line 5); called at line 115 inside try/catch. |
| `src/app/api/checkout/confirm/route.ts` | `src/lib/payments/bucket-bank-code.ts` | import | ✓ WIRED | `import { bucketBankCode } from "@/lib/payments/bucket-bank-code"` (line 6); invoked at line 86 to populate `reason=` param. |
| `src/app/api/checkout/confirm/route.ts` | `src/lib/kv.ts redis` | import (SETNX dedup) | ✓ WIRED | `import { redis } from "@/lib/kv"` (line 4); `redis.set(dedupeKey, "pending", { nx: true, ex: 604800 })` at line 101. Collision check at line 106. |
| BPoint iframe redirect | `/api/checkout/confirm` | createAuthKey RedirectionUrl | ✓ WIRED | `src/lib/bpoint.ts:83` sets `RedirectionUrl: ${args.redirectionUrlBase}/api/checkout/confirm`. Confirm route exists + tested. |
| `handleConfirmedPayment` | `@/lib/kv` (updateSession, redis) | import | ✓ WIRED | `src/lib/payments/handleConfirmedPayment.ts:1`. Both calls present (lines 50, 67). |
| `handleConfirmedPayment` | `@/lib/intake` (getIntake) | import | ✓ WIRED | Line 2; called at line 41 with null-guard at 42-46. |
| `handleConfirmedPayment` | `@/lib/upload-tokens` (createUploadToken, hashToken) | import | ✓ WIRED | Line 3; both called (57, 67). |
| `handleConfirmedPayment` | `@/lib/resend` (resend + sendTranscriptEmail) | import | ✓ WIRED | Line 4; both called (85, 98). |
| `handleConfirmedPayment` | `@/lib/email/payment-receipt` | default import | ✓ WIRED | Line 6 (`import PaymentReceipt`); rendered as React element into `resend.emails.send.react` (line 89). |
| `chat-widget.tsx` | `MessageList.failureReason` / `onRetryRequested` | props pass-through | ✓ WIRED | `chat-widget.tsx:150-151` passes `failureReason={paymentFailureReason}` and `onRetryRequested={handleRetryRequested}`. |
| `message-list.tsx` | `PaymentCard.failureReason` / `onRetryRequested` | props w/ isLatest guard | ✓ WIRED | `message-list.tsx:207-208` forwards both props gated by `isLatest = msgIndex === lastMsgIndex`. |

### Requirements Coverage

| Req | Source Plan | Description | Status | Evidence |
|-----|-------------|-------------|--------|----------|
| CONF-01 | 02-00 + 02-03 | GET /api/checkout/confirm handles browser redirect with ResultKey | ✓ SATISFIED | `src/app/api/checkout/confirm/route.ts` exports GET; parses ResultKey (defensive casing); 8/8 confirm-route tests GREEN. |
| CONF-02 | 02-00 + 02-01 + 02-03 | Server-side call to BPoint Retrieve Transaction API | ✓ SATISFIED | `retrieveTransaction` in bpoint.ts + invoked at confirm/route.ts:71. bpoint.test.ts (2/2 GREEN) pins URL + Basic Auth + throw-on-non-OK. |
| CONF-03 | 02-00 + 02-03 | Dual verification — ResponseCode===0 AND Approved===true | ✓ SATISFIED | `route.ts:81-82`: `apiOk = txn.APIResponse?.ResponseCode === 0; approved = apiOk && txn.TxnResp?.Approved === true`. confirm-route.test.ts tests 4-6 verify. |
| CONF-04 | 02-00 + 02-02 + 02-03 | Fan-out on success: session update → upload token → receipt email → transcript email | ✓ SATISFIED | Shared helper `handleConfirmedPayment.ts` (5-step fan-out, all imports wired); confirm route invokes it. handle-confirmed-payment.test.ts (5/5 GREEN). |
| CONF-05 | 02-00 + 02-03 | Redis SETNX prevents duplicate fan-out on replay | ✓ SATISFIED | `route.ts:101`: `redis.set(bpoint-txn:{TxnNumber}, "pending", { nx: true, ex: 604800 })`. Collision at line 106 skips fan-out and returns successRedirect. confirm-route.test.ts test 7 verifies. |
| UI-01 | 02-00 + 02-04 | PaymentCard replaces Stripe with BPoint iframe | ✓ SATISFIED | Zero `@stripe/*` imports in payment-card.tsx; iframe at lines 164-170 uses `bpointIframeUrl(authKey)`. payment-card.test.tsx tests 1-2 GREEN. *Live render of iframe DOM pending external BPoint HPP activation — see human_verification.* |
| UI-02 | 02-00 + 02-01 + 02-04 | User sees clear failure messages mapped from BPoint codes | ✓ SATISFIED | `bucket-bank-code.ts` maps 12 codes → 3 buckets (+ system default); `FAILURE_COPY` record in payment-card.tsx renders locked user-facing strings. bucket-bank-code.test.ts (15/15 GREEN). |
| UI-03 | 02-04 | CSP headers allow BPoint iframe origins | ✓ SATISFIED | `next.config.ts:13` sets `frame-src https://www.bpoint.com.au` on `/:path*`. Single CSP header (avoids browser intersection behaviour). |
| UI-04 | 02-00 + 02-04 | Payment UI handles AuthKey expiry; user can retry | ✓ SATISFIED | `PaymentCard` failure UI with `"Start again"` button; `handleStartAgain` → `onRetryRequested?.()` + fresh `fetchAuthKey()`. Chat-widget clears state. Operator-verified on dev server. payment-card.test.tsx tests 3-4 + chat-widget.test.tsx (6/6 GREEN). |

**All 9 phase-02 requirement IDs accounted for.** No orphaned requirements: REQUIREMENTS.md lists exactly CONF-01..05 + UI-01..04 for Phase 2 (lines 104-112), every one appears in at least one plan's `requirements:` frontmatter.

### Anti-Patterns Scanned

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/components/chat/message-list.tsx` | 204 | `urgency={part.input?.urgency ?? "non-urgent"}` | ℹ️ Info (NOT a phase-02 gap) | Silent misbilling risk if LLM emits tool call without urgency. Pre-existing per git-blame commit `427456f` (before phase-02 commits). Tracked as separate background task per 02-04-SUMMARY.md. |

No TODO/FIXME/PLACEHOLDER/stub-return patterns found in any phase-02 file (`src/lib/bpoint.ts`, `src/lib/payments/*.ts`, `src/app/api/checkout/confirm/route.ts`, `src/components/payment/payment-card.tsx`, `src/components/chat/chat-widget.tsx`, `next.config.ts`). No empty handlers. No console-log-only implementations.

### Human Verification Required

1. **Live BPoint iframe content render**
   - **Test:** Complete a full intake in the chat, wait for PaymentCard to mount, confirm `POST /api/checkout` returns a real authKey (not HTTP 200 with `APIResponse.ResponseCode=2`), and the iframe renders the BPoint card-entry form with zero CSP console violations.
   - **Expected:** Visible BPoint iframe card form inside PaymentCard; no CSP frame-src violations in browser console.
   - **Why human:** Requires live BPoint facility with HPP product entitlement. Code path is correct (request shape verified Phase-01, CSP header verified static, URL construction unit-tested); only the product entitlement is missing externally.
   - **Blocker:** External — BPoint HPP activation carried forward from Phase 01. See `external_blocker` in frontmatter.

2. **End-to-end payment smoke test**
   - **Test:** Complete a full BPoint iframe payment. Verify: browser lands on `/?payment=success`, URL clears to `/`, Redis `bpoint-txn:{TxnNumber}` key is set, client receives receipt email, firm receives transcript email (Zapier → Smokeball line items reconcile), upload token link works.
   - **Expected:** All five fan-out steps observable; no duplicate emails on refresh; chat advances past payment tool.
   - **Why human:** Requires live BPoint UAT + Resend + Zapier. Planned as Phase 4 UAT scope.
   - **Blocker:** External — Phase-01 BPoint HPP activation + Phase-4 UAT scope.

### Gaps Summary

**No phase-02 code gaps.** All five observable truths have complete, substantive, wired implementations verified by 40/40 passing unit tests, grep-based static analysis, and `npx tsc --noEmit` clean. Imports are bidirectionally wired (confirm route ↔ bpoint.ts ↔ handleConfirmedPayment.ts ↔ kv/intake/upload-tokens/resend; chat-widget → message-list → payment-card prop chain intact).

The single unverified item (truth 1, iframe-content render) is blocked by a **carried-forward external dependency from Phase 01** (BPoint HPP product entitlement). This is correctly classified as `human_needed`, not `gaps_found` — no phase-02 code change would alter the outcome; only BPoint support activating the product will.

Phase 02 is **code-complete and ready for Phase 03** (webhook + Stripe cleanup). The `handleConfirmedPayment` helper is explicitly designed for reuse by the upcoming BPoint webhook handler, and the `bpoint-txn:{TxnNumber}` dedup key convention is established.

---

_Verified: 2026-04-24T10:20:00Z_
_Verifier: Claude (gsd-verifier)_
