---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: unknown
stopped_at: "Completed 03-04-PLAN.md (Stripe fully removed: 2 source files deleted, 3 npm packages uninstalled, env/docs scrubbed, Redis namespace fully migrated, late-upload read bug fixed; 49/49 tests green)"
last_updated: "2026-04-24T06:29:37.200Z"
progress:
  total_phases: 4
  completed_phases: 3
  total_plans: 13
  completed_plans: 13
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-23)

**Core value:** Lawyers can accept BPoint payments from clients directly in the chat, with payment status triggering downstream workflows to Smokeball CRM via Zapier.
**Current focus:** Phase 03 — webhook-cleanup

## Current Position

Phase: 03 (webhook-cleanup) — COMPLETE
Plan: 4 of 4 (all plans complete)

## Performance Metrics

**Velocity:**

- Total plans completed: 5
- Average duration: ~2min
- Total execution time: ~10 min

**By Phase:**

| Phase          | Plans | Total | Avg/Plan |
|----------------|-------|-------|----------|
| 01-foundation  | 4     | 6min  | ~1.5min  |

**Recent Trend:**

- Last 5 plans: Phase 01-foundation P01 (2min, 2 tasks, 2 files), Phase 01-foundation P02 (1min, 1 task, 1 file), Phase 01-foundation P03 (2min, 3 tasks, 9 files), Phase 01-foundation P04 (1min, 1 task, 1 file)
- Trend: stable/fast

*Updated after each plan completion*
| Phase 01-foundation P04 | 1min | 1 tasks | 1 files |
| Phase 02-confirmation-ui P00 | 4min | 4 tasks | 9 files |
| Phase 02-confirmation-ui P02 | 1min | 1 tasks | 1 files |
| Phase 02 P01 | 1min | 2 tasks | 2 files |
| Phase 02-confirmation-ui P03 | ~12min | 2 tasks | 1 files |
| Phase 02-confirmation-ui P04 | ~4h | 4 tasks | 4 files |
| Phase 03-webhook-cleanup P01 | 1min | 1 tasks | 1 files |
| Phase 03 P02 | 2min | 2 tasks | 3 files |
| Phase 03 P03 | ~2min | 1 tasks (+1 Rule-3 deviation) | 2 files |
| Phase 03 P04 | ~5min | 3 tasks | 7 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Init: Replace Stripe with BPoint iframe (single-page mode) — matches existing embedded UX
- Init: Maintain lineItem and tier structure — Smokeball invoice reconciliation depends on exact strings
- Init: Keep session/webhook architecture — only swap provider logic, not the flow shape
- [Phase 01-foundation]: Pricing moved to provider-neutral src/lib/pricing.ts; stripe.ts re-exports for back-compat
- [Phase 01-foundation]: Plan 01-02: BPoint AuthKey client uses per-call BPOINT_ENV evaluation (not module-level) to avoid Vercel bundle-time pinning
- [Phase 01-foundation]: Plan 01-02: Basic Auth header format is username|merchantNumber:password (pipe separator mandatory per BPoint v5, not standard user:pass)
- [Phase 01-foundation]: Plan 01-03: Field renamed stripeSessionId -> bpointTxnNumber across types/Redis/intake/email/routes (9 files); Stripe session IDs continue populating the renamed field during Phase 1 soak
- [Phase 01-foundation]: Plan 01-03: checkout/route.ts limited to 2-site field-name swap; createCheckoutSession call + clientSecret response shape deferred to Plan 04
- [Phase 01-foundation]: Plan 01-03: Zapier transcript HTML row count preserved (7 rows); only label text changed Stripe Session -> BPoint Transaction (DATA-02 contract intact)
- [Phase 01-foundation]: Plan 01-04: POST /api/checkout now returns { authKey } — no clientSecret alias (PaymentCard UI breakage expected; Phase 2 swaps in BPoint iframe)
- [Phase 01-foundation]: Plan 01-04: Nested try/catch isolates Redis persistence failures from BPoint 502s — AuthKey creation success must not be gated on Upstash health
- [Phase 01-foundation]: Plan 01-04: BPoint upstream failures return 502 (not 500) with sanitized client-facing error; provider-specific detail stays in server logs
- [Phase 02-confirmation-ui]: Plan 02-00: vitest.config must be .mts — vite-tsconfig-paths is ESM-only
- [Phase 02-confirmation-ui]: Plan 02-00: scrollIntoView polyfill added to tests/setup.ts — jsdom does not implement it and chat-widget uses it in useEffect
- [Phase 02-confirmation-ui]: Plan 02-00: environmentMatchGlobs wiring — .tsx to jsdom, .ts to node default — keeps lib tests fast and DOM tests in jsdom
- [Phase 02-confirmation-ui]: Plan 02-01: retrieveTransaction reuses existing getBpointConfig + buildBpointAuthHeader — single source of truth for BPoint auth
- [Phase 02-confirmation-ui]: Plan 02-01: Unknown/empty BankResponseCode defaults to 'system' bucket — avoids leaking raw codes and degrades gracefully
- [Phase 02-confirmation-ui]: Plan 02-01: Error text 'BPoint retrieve failed: {status}' pinned by test regex — stable contract for downstream confirm-route handling
- [Phase 02-confirmation-ui]: Plan 02-02: Shared fan-out helper extracted to src/lib/payments/handleConfirmedPayment.ts — consumed by Phase 2 confirm route AND Phase 3 BPoint webhook (no duplication); throws on null intake so caller owns user-facing outcome; dedup key prefix bpoint-txn:{TxnNumber} with pending→hashToken upgrade
- [Phase 02-confirmation-ui]: Plan 02-03: GET /api/checkout/confirm treats URL ResponseCode as hint only — authoritative answer always from server-side retrieveTransaction (URL params are browser-forgeable)
- [Phase 02-confirmation-ui]: Plan 02-03: Fan-out exceptions caught and logged with bpointTxnNumber but route still returns success redirect — payment is real (BPoint captured), support reconciles from logs rather than showing user a failure for already-captured money
- [Phase 02-confirmation-ui]: Plan 02-03: Defensive ResultKey/resultkey casing parse closes 02-RESEARCH.md Open Question 2
- [Phase 02-confirmation-ui]: Plan 02-03: Smoke test approved — four curl probes returned 307 redirects with expected Location query params
- [Phase 02-confirmation-ui]: Plan 02-04: toolCallId Strategy A — handlePaymentComplete('') relies on MessageList isLatest guard; handlePaymentComplete does not consume toolCallId for AI tool-result bookkeeping so empty-string is safe
- [Phase 02-confirmation-ui]: Plan 02-04: Single CSP header combines frame-ancestors * and frame-src https://www.bpoint.com.au with semicolon separator to avoid browser most-restrictive intersection of multiple headers
- [Phase 02-confirmation-ui]: Plan 02-04: Iframe-render sub-check deferred to Phase-01 external BPoint HPP activation blocker (ResponseCode 2 "Invalid permissions" until BPoint support 1300 766 031 / Support Code 273 516 enables HPP at facility level) — NOT a Phase-02 issue
- [Phase 02-confirmation-ui]: Plan 02-04: Pre-existing urgency-default bug in message-list.tsx:204 (introduced in 427456f, predates Phase 02) triaged separately — Phase 02 renders whatever urgency the tool input contains
- [Phase 03-webhook-cleanup]: Plan 03-01: RED scaffold locks behavior contract for webhook — 9 cases (8 from RESEARCH + 1 defensive casing from CONTEXT), fixture reuse (no new fixtures), mock symmetry with tests/confirm-route.test.ts verbatim
- [Phase 03-webhook-cleanup]: Plan 03-02: WebHookUrl serialized conditionally (ternary to undefined) — JSON.stringify elides undefined keys, keeping ProcessTxnData byte-identical for legacy callers that don't pass webhookUrlBase
- [Phase 03-webhook-cleanup]: Plan 03-02: Reused NEXT_PUBLIC_URL for webhookUrlBase (no new env var) — POST /api/checkout passes it through symmetrically with the existing redirectionUrlBase plumbing
- [Phase 03-webhook-cleanup]: Plan 03-02: Webhook route is a carbon-copy of confirm route minus browser redirects — same retrieveTransaction+dual-verify+SETNX+handleConfirmedPayment pipeline, shared bpoint-txn:{TxnNumber} namespace with 7-day TTL; whichever path wins SETNX owns fan-out
- [Phase 03-webhook-cleanup]: Plan 03-02: WEBH-04 enforced — every branch returns 200 {received:true} (retrieveTransaction throws, Approved=false, ResponseCode!==0, SETNX collision, fan-out throws); BPoint treats non-2xx as retry so failures are logged with [bpoint-webhook] tag but never propagate
- [Phase 03-webhook-cleanup]: Plan 03-03: Resume route always issues fresh AuthKey — BPoint v2 has no retrieve-by-AuthKey API, so TTL-reuse branch intentionally omitted; redirects to /?payment=resume so chat-widget re-mounts PaymentCard with the new AuthKey from intake
- [Phase 03-webhook-cleanup]: Plan 03-03: createAuthKey failures in resume route degrade to /?expired=1 (never 5xx) — matches locked CONTEXT decision and keeps the half-finished-payment recovery UX resilient
- [Phase 03-webhook-cleanup]: Plan 03-03: webhookUrlBase threaded through on resume — refreshed AuthKey still registers BPoint server-to-server callback, keeping initial and resumed flows symmetric
- [Phase 03-webhook-cleanup]: Plan 03-03: selectUrgency PRICING import redirected from @/lib/stripe to @/lib/pricing (Rule-3 deviation) — closes overlooked Phase 01 back-compat residue that would have blocked Plan 04's stripe.ts deletion
- [Phase 03-webhook-cleanup]: Plan 03-04: Fixed late-upload lookupRecordBySessionId dead Redis read as Rule-1 deviation — function silently read stripe-session:{sessionId} after Phase 02 migrated writer to bpoint-txn:{TxnNumber}, now resolves sessionId -> getSession.bpointTxnNumber -> bpoint-txn:{bpointTxnNumber}
- [Phase 03-webhook-cleanup]: Plan 03-04: Split BPOINT_BILLER_CODE from the Required env var promotion — only needed for BPAY flows (not card-only), kept in Optional; username/password/merchant-number/env are genuinely required
- [Phase 03-webhook-cleanup]: Plan 03-04: Zero Stripe surface area achieved — 2 source files deleted, 3 npm packages uninstalled, .env.example + INTEGRATIONS.md case-insensitive-stripe-grep-clean, Redis dedup namespace bpoint-txn:* end-to-end, 49/49 tests green

### Pending Todos

None yet.

### Blockers/Concerns

- UAT credentials required before Phase 1 can be tested — must be obtained from the firm (BPoint issues UAT creds separately from production)
- BPoint v5 webhook payload schema is not publicly accessible — must capture raw POST body from a UAT test transaction in Phase 3 before finalising Zod schema
- BPoint Merchant Back Office access needed to configure server-to-server callback URL — firm must provide this for Phase 3

## Session Continuity

Last session: 2026-04-24T06:23:56.374Z
Stopped at: Completed 03-04-PLAN.md (Stripe fully removed: 2 source files deleted, 3 npm packages uninstalled, env/docs scrubbed, Redis namespace fully migrated, late-upload read bug fixed; 49/49 tests green)
Resume file: None
