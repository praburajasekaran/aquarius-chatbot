---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: unknown
stopped_at: Completed 01-02-PLAN.md (BPoint AuthKey client in src/lib/bpoint.ts)
last_updated: "2026-04-23T17:35:37.505Z"
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 4
  completed_plans: 2
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-23)

**Core value:** Lawyers can accept BPoint payments from clients directly in the chat, with payment status triggering downstream workflows to Smokeball CRM via Zapier.
**Current focus:** Phase 01 — foundation

## Current Position

Phase: 01 (foundation) — EXECUTING
Plan: 3 of 4

## Performance Metrics

**Velocity:**

- Total plans completed: 2
- Average duration: ~1.5min
- Total execution time: ~3 min

**By Phase:**

| Phase          | Plans | Total | Avg/Plan |
|----------------|-------|-------|----------|
| 01-foundation  | 2     | 3min  | ~1.5min  |

**Recent Trend:**

- Last 5 plans: Phase 01-foundation P01 (2min, 2 tasks, 2 files), Phase 01-foundation P02 (1min, 1 task, 1 file)
- Trend: stable/fast

*Updated after each plan completion*

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

### Pending Todos

None yet.

### Blockers/Concerns

- UAT credentials required before Phase 1 can be tested — must be obtained from the firm (BPoint issues UAT creds separately from production)
- BPoint v5 webhook payload schema is not publicly accessible — must capture raw POST body from a UAT test transaction in Phase 3 before finalising Zod schema
- BPoint Merchant Back Office access needed to configure server-to-server callback URL — firm must provide this for Phase 3

## Session Continuity

Last session: 2026-04-23T17:35:37.503Z
Stopped at: Completed 01-02-PLAN.md (BPoint AuthKey client in src/lib/bpoint.ts)
Resume file: .planning/phases/01-foundation/01-03-PLAN.md
