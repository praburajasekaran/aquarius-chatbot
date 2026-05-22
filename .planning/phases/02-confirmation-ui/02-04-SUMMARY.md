---
phase: 02-confirmation-ui
plan: 04
subsystem: ui
tags: [payment-card, bpoint, iframe, csp, chat-widget, url-signal, react]

requires:
  - phase: 01-foundation
    provides: "POST /api/checkout returning { authKey } (no clientSecret)"
  - phase: 02-confirmation-ui
    provides: "Plan 02-03 GET /api/checkout/confirm route that redirects with ?payment=success|failed&reason=..."
provides:
  - "PaymentCard renders BPoint iframe at https://www.bpoint.com.au/webapi/v2/txns/iframe/{authKey}"
  - "Zero @stripe/* imports in payment-card.tsx (Stripe EmbeddedCheckout fully replaced)"
  - "Four-bucket failure UI (declined / invalid / system / expired) with locked CONTEXT.md copy"
  - "Expiry recovery flow: 'Start again' button issues fresh POST /api/checkout"
  - "next.config.ts CSP allows frame-src https://www.bpoint.com.au"
  - "chat-widget.tsx reads ?payment=success|failed&reason=... and clears URL via window.history.replaceState"
affects: [phase-03-webhooks, phase-04-testing]

tech-stack:
  added: []
  patterns:
    - "URL-signal → component-state bridge: chat-widget reads ?payment= on mount, drives PaymentCard via failureReason prop, then clears URL to prevent refresh re-trigger"
    - "isLatest guard for tool-call fan-out: latest PaymentCard alone receives failureReason/onRetryRequested (toolCallId Strategy A)"
    - "Single Content-Security-Policy header combining frame-ancestors + frame-src directives with semicolon separator"

key-files:
  created: []
  modified:
    - "src/components/payment/payment-card.tsx (Stripe → BPoint iframe + 4-state status machine + Start again)"
    - "src/components/chat/message-list.tsx (forwards failureReason / onRetryRequested to latest PaymentCard)"
    - "src/components/chat/chat-widget.tsx (useEffect URL-signal reader, replaceState clear, PaymentFailureReason state)"
    - "next.config.ts (CSP frame-src for www.bpoint.com.au added to /:path* header block)"

key-decisions:
  - "toolCallId Strategy A: handlePaymentComplete('') relies on MessageList isLatest guard (handlePaymentComplete does not use toolCallId for AI tool-result bookkeeping, so empty-string is safe)"
  - "Single CSP header with both frame-ancestors * and frame-src https://www.bpoint.com.au separated by semicolon (avoids browser most-restrictive intersection of multiple headers)"
  - "Status state machine seeds from failureReason prop on mount (initial fetchAuthKey suppressed when failure-driven)"
  - "Iframe-render sub-check deferred to Phase-01 BPoint HPP activation blocker — 3 of 4 human-verify sub-checks passed; iframe cannot render until BPoint support enables Hosted Payment Page product at facility level"

patterns-established:
  - "URL ?payment=success|failed pattern: chat-widget reads on mount only (eslint-disable exhaustive-deps), dispatches via existing onPaymentComplete pathway, then replaceState clears to prevent refresh re-trigger"
  - "Failure-bucket copy pinned in a const FAILURE_COPY record — any future reason additions require both a type extension AND a record entry, enforced at compile time"

requirements-completed: [UI-01, UI-02, UI-03, UI-04]

duration: ~4h (including human-verify checkpoint)
completed: 2026-04-24
---

# Phase 02 Plan 04: PaymentCard BPoint iframe + chat-widget URL-signal wiring Summary

**Replaced Stripe EmbeddedCheckout with a direct BPoint iframe, wired chat-widget to read ?payment= URL params from the confirm-route redirect, and updated CSP to allow the BPoint origin — completing the Phase 2 UI surface.**

## Performance

- **Duration:** ~4h (spread across 2 agent sessions; Tasks 1-3 automated, Task 4 human-verify checkpoint)
- **Started:** 2026-04-24 (plan Tasks 1-3 execution)
- **Completed:** 2026-04-24T04:42:04Z
- **Tasks:** 4 (3 auto + 1 human-verify checkpoint)
- **Files modified:** 4

## Accomplishments

- PaymentCard no longer imports `@stripe/stripe-js` or `@stripe/react-stripe-js`; renders `<iframe src="https://www.bpoint.com.au/webapi/v2/txns/iframe/{authKey}">` once `POST /api/checkout` resolves.
- Four failure buckets with locked CONTEXT.md copy (declined / invalid / system / expired) plus a "Start again" expiry-recovery button that issues a fresh `/api/checkout` call.
- `next.config.ts` CSP combined into a single header: `frame-ancestors *; frame-src https://www.bpoint.com.au` on `/:path*`.
- `chat-widget.tsx` reads `?payment=success|failed&reason=...` on mount, drives the latest PaymentCard via `failureReason`, and clears the URL via `window.history.replaceState` so refreshes never re-trigger the effect.
- 40/40 Phase-2 Vitest unit tests GREEN end-to-end; `npm run build` passes.

## Task Commits

1. **Task 1: Replace PaymentCard Stripe iframe with BPoint iframe + 3-bucket failure UI + expiry retry** — `ced2623` (feat)
2. **Task 2: Wire chat-widget to read ?payment= URL param and signal latest PaymentCard** — `2bf4b4c` (feat)
3. **Task 3: Add BPoint origin to next.config.ts CSP frame-src** — `f7b188d` (chore)
4. **Task 4: Manual UI verification — iframe loads, expiry UI works, no CSP violations** — human-verify checkpoint (no code commit; see below)

**Plan metadata:** _this finalization commit_

## Files Created/Modified

- `src/components/payment/payment-card.tsx` — Stripe EmbeddedCheckout replaced by BPoint iframe; 4-state status machine (loading/ready/expired/declined/invalid/system/error); AlertTriangle + RefreshCw Lucide icons; Start again button re-fetches /api/checkout.
- `src/components/chat/message-list.tsx` — props interface extended with `failureReason?` and `onRetryRequested?`; forwarded to latest PaymentCard only (via `isLatest` guard).
- `src/components/chat/chat-widget.tsx` — `useEffect` URL-signal reader on mount; `paymentFailureReason` state; `handleRetryRequested` clears failure state; `handlePaymentComplete("")` on `?payment=success` (Strategy A — toolCallId unused by bookkeeping).
- `next.config.ts` — CSP on `/:path*` now: `frame-ancestors *; frame-src https://www.bpoint.com.au`.

## Decisions Made

- **toolCallId Strategy A** (see 02-04-PLAN.md Task 2 action block): `handlePaymentComplete` in chat-widget does not consume `toolCallId` for AI tool-result bookkeeping (no `addToolResult` call, no `messages.find(p.toolCallId === …)` lookup), so passing `""` from the URL-signal `useEffect` is safe — the `isLatest` guard in MessageList restricts the success dispatch to the latest PaymentCard, and the empty string is never compared for equality.
- **Single CSP header** combining both directives with `; ` avoids the browser's most-restrictive-intersection behaviour for multiple CSP headers (RFC-ambiguous; Chrome intersects frame-src when sent as two headers).
- **Failure-state seeds from prop on mount**: `useState<Status>(failureReason ?? "loading")` + a companion effect mirroring `failureReason` changes — ensures a navigation to `/?payment=failed&reason=expired` renders the expired UI without first flashing "Preparing secure payment…" and firing an unnecessary auth-key fetch.
- **Iframe-render sub-check deferred** to the Phase-01 external blocker. Operator approved "approved B" understanding the iframe cannot render real BPoint content until BPoint support activates the HPP product at the facility level.

## Deviations from Plan

None — plan executed exactly as written. No auto-fixes were required during Tasks 1-3, and the human-verify checkpoint produced no code changes.

## Human-Verify Checkpoint Outcomes (Task 4)

**VERIFIED on dev server port 3001 (Operator, 2026-04-24):**

| Sub-check | URL | Expected copy | Result |
|-----------|-----|---------------|--------|
| Expired | `/?payment=failed&reason=expired` | "Payment session expired" + Start again button | ✓ |
| Declined | `/?payment=failed&reason=declined` | "Card declined — please try another card." | ✓ |
| Invalid | `/?payment=failed&reason=invalid` | "Invalid card details — please check and try again." | ✓ |
| System | `/?payment=failed&reason=system` | "Payment couldn't be processed right now — please try again in a moment." | ✓ (observed naturally when POST /api/checkout 502'd during the intake walkthrough) |
| URL clear after read | all four | window.history.replaceState clears `?payment=…` | ✓ (all four) |
| Start again → /api/checkout | expired path | fresh POST /api/checkout in Network tab | ✓ |

**DEFERRED sub-check — iframe DOM renders BPoint content + zero CSP console violations:**
- Blocked by the **same external BPoint HPP activation blocker** documented in `.planning/phases/01-foundation/01-VERIFICATION.md`.
- `createAuthKey` returns `APIResponse.ResponseCode === 2` ("Invalid permissions") on the live merchant facility until BPoint support enables the Hosted Payment Page / iframe (3-party integration) product for merchant `5353109297032146`.
- Action required (external, carries forward from Phase 01): call BPoint support **1300 766 031**, Support Code **273 516**. Request "enable Hosted Payment Page / iframe (3-party integration) product for merchant 5353109297032146 so the processtxnauthkey API is accessible to SCI user aquarius-chatbot-uat."
- What IS verified statically in this plan: CSP header value is correct (`frame-src https://www.bpoint.com.au`), iframe `src` URL construction is correct (`bpointIframeUrl(authKey)`), and tests/payment-card.test.tsx Test 1 pins the URL format. The iframe-load path will work as-designed the moment BPoint enables the product — no Phase-02 code change is pending.

Operator resume signal: **"approved B"** — finalize 02-04 with iframe-render sub-check deferred to the Phase-01 BPoint blocker.

## Issues Encountered

**Separate pre-existing bug discovered during the walkthrough (OUT OF SCOPE FOR PHASE 02):**
During Task 4 verification, the operator observed the LLM calling `initiatePayment` with `urgency: "non-urgent"` despite the user selecting **Urgent** in the intake. Investigation:
- The failure path is in `message-list.tsx:204`: `urgency={part.input?.urgency ?? "non-urgent"}` — when the model emits the tool call without an explicit urgency field, the component silently defaults to non-urgent.
- `git blame` confirms this line predates Phase 02 and was introduced in commit `427456f` (pre-Phase-01). It is NOT a regression caused by this plan.
- Root cause is upstream: either (a) the model's intake-state is dropping urgency before the tool call, or (b) the system prompt / tool input schema is not enforcing urgency as required.
- **Action:** Triaged to a separate background task — NOT addressed here. Phase 02's UI surface only *renders* whatever urgency the tool input contains; Phase 02 is not responsible for filling that field.

This issue is explicitly noted so downstream phases (especially Phase 4 UAT) don't mis-attribute it to Phase-02 changes.

## User Setup Required

None — no external service configuration required for this plan. (The external BPoint HPP activation is a phase-01 blocker, not a phase-02 user-setup item.)

## Next Phase Readiness

- Phase 2 UI work is complete: PaymentCard + chat-widget + CSP + confirm route all wired end-to-end.
- The next plan in this phase (if any) can proceed; Phase 02 currently has 02-00 through 02-04 — plan 04 is the last plan, so **Phase 02 is complete** once this SUMMARY is committed.
- Deferred: iframe-content render verification (blocked on external BPoint HPP activation from Phase 01).
- Carry-forward for Phase 03 (webhooks): the `handleConfirmedPayment` fan-out helper from plan 02-02 is ready to be re-used by the BPoint webhook handler. The `?payment=success` URL-signal path is the browser-side equivalent; the webhook will be the server-to-server path.
- Carry-forward for Phase 04 (testing): add an E2E regression test for the urgency-default bug in `message-list.tsx:204` once the root cause is triaged.

---
*Phase: 02-confirmation-ui*
*Completed: 2026-04-24*

## Self-Check: PASSED

- Task 1 commit `ced2623` — found in git log
- Task 2 commit `2bf4b4c` — found in git log
- Task 3 commit `f7b188d` — found in git log
- `src/components/payment/payment-card.tsx` — exists (modified in ced2623)
- `src/components/chat/message-list.tsx` — exists (modified in ced2623)
- `src/components/chat/chat-widget.tsx` — exists (modified in 2bf4b4c)
- `next.config.ts` — exists (modified in f7b188d)
- All 4 tasks documented with outcomes; deviations = None; deferred iframe-render sub-check linked to Phase-01 external blocker.
