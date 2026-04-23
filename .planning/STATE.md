---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: phase-01-complete
stopped_at: Completed 01-04-PLAN.md (checkout route swapped to BPoint createAuthKey; Phase 1 foundation complete)
last_updated: "2026-04-23T17:40:47.221Z"
progress:
  total_phases: 4
  completed_phases: 1
  total_plans: 4
  completed_plans: 4
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-23)

**Core value:** Lawyers can accept BPoint payments from clients directly in the chat, with payment status triggering downstream workflows to Smokeball CRM via Zapier.
**Current focus:** Phase 01 — foundation

## Current Position

Phase: 01 (foundation) — COMPLETED
Plan: 4 of 4 (all plans complete; ready for Phase 02)

## Performance Metrics

**Velocity:**

- Total plans completed: 4
- Average duration: ~1.5min
- Total execution time: ~6 min

**By Phase:**

| Phase          | Plans | Total | Avg/Plan |
|----------------|-------|-------|----------|
| 01-foundation  | 4     | 6min  | ~1.5min  |

**Recent Trend:**

- Last 5 plans: Phase 01-foundation P01 (2min, 2 tasks, 2 files), Phase 01-foundation P02 (1min, 1 task, 1 file), Phase 01-foundation P03 (2min, 3 tasks, 9 files), Phase 01-foundation P04 (1min, 1 task, 1 file)
- Trend: stable/fast

*Updated after each plan completion*
| Phase 01-foundation P04 | 1min | 1 tasks | 1 files |

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

### Pending Todos

None yet.

### Blockers/Concerns

- UAT credentials required before Phase 1 can be tested — must be obtained from the firm (BPoint issues UAT creds separately from production)
- BPoint v5 webhook payload schema is not publicly accessible — must capture raw POST body from a UAT test transaction in Phase 3 before finalising Zod schema
- BPoint Merchant Back Office access needed to configure server-to-server callback URL — firm must provide this for Phase 3

## Session Continuity

Last session: 2026-04-23T17:39:22Z
Stopped at: Completed 01-04-PLAN.md (checkout route swapped to BPoint createAuthKey; Phase 1 foundation complete)
Resume file: Phase 02 (UI swap — replace PaymentCard with BPoint iframe)
