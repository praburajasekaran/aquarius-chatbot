# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-23)

**Core value:** Lawyers can accept BPoint payments from clients directly in the chat, with payment status triggering downstream workflows to Smokeball CRM via Zapier.
**Current focus:** Phase 1 — Foundation

## Current Position

Phase: 1 of 4 (Foundation)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-04-23 — Roadmap created, requirements mapped, STATE.md initialized

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: -
- Trend: -

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Init: Replace Stripe with BPoint iframe (single-page mode) — matches existing embedded UX
- Init: Maintain lineItem and tier structure — Smokeball invoice reconciliation depends on exact strings
- Init: Keep session/webhook architecture — only swap provider logic, not the flow shape

### Pending Todos

None yet.

### Blockers/Concerns

- UAT credentials required before Phase 1 can be tested — must be obtained from the firm (BPoint issues UAT creds separately from production)
- BPoint v5 webhook payload schema is not publicly accessible — must capture raw POST body from a UAT test transaction in Phase 3 before finalising Zod schema
- BPoint Merchant Back Office access needed to configure server-to-server callback URL — firm must provide this for Phase 3

## Session Continuity

Last session: 2026-04-23
Stopped at: Roadmap created — ready to begin Phase 1 planning
Resume file: None
