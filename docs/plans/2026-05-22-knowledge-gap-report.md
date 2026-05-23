# Plan: Knowledge Gap Report

> Created: 2026-05-22
> Status: completed
> Trigger: Implement `/var/folders/b0/zz_zl2s966lf3tkcw9qlppp80000gn/T/handoff-XXXXXX.md.4Cy2SqKn7l`

## Goal & Success Criteria
- **Goal**: Convert the existing unanswered-question report into the monthly Knowledge Gap Report described in `CONTEXT.md`.
- **Done when**: unmatched visitor information questions are stored as sanitized knowledge gaps with counts and categories, the monthly cron email reports them to the enrichment recipient, and focused tests pass.
- **Non-goals**: Broader practice-area chatbot support, transcript reporting, LLM-based categorization, data-file renames.

## Current State
- `src/lib/tools/log-unanswered.ts` stores normalized strings in Redis sorted sets under `unanswered:YYYY-MM`.
- `src/app/api/cron/unanswered-report/route.ts` reads those sorted sets and sends to `FIRM_NOTIFY_EMAIL`.
- `src/lib/email/templates/unanswered-report.tsx` reports first-seen dates and criminal-law-specific copy.
- `src/lib/system-prompt.ts` asks the model to call `matchQuestion` only for criminal-law questions.

## Task Breakdown

| # | Task | Files | Size | Depends On |
|---|------|-------|------|------------|
| 1 | Add knowledge-gap storage helpers | `src/lib/tools/log-unanswered.ts` | M | - |
| 2 | Update cron route | `src/app/api/cron/unanswered-report/route.ts` | M | T1 |
| 3 | Update email copy and props | `src/lib/email/templates/unanswered-report.tsx` | S | T2 |
| 4 | Update tool/prompt/env wording | `src/lib/tools/match-question.ts`, `src/lib/system-prompt.ts`, `.env.example` | S | T1 |
| 5 | Add tests | `src/lib/tools/log-unanswered.test.ts`, `src/app/api/cron/unanswered-report/route.test.ts` | M | T1-T4 |

## Technical Design
- **Approach**: Keep the existing route and file names for compatibility, but change stored data to Redis hashes keyed by normalized question within a monthly sorted-set index. The hash preserves canonical sanitized wording, `timesAsked`, category, and normalized key. The monthly index is used to enumerate gaps, then the route sorts by `timesAsked` descending with alphabetical tie-breaks.
- **Alternatives rejected**: Renaming the route/files is churn without behavior benefit. LLM categorization conflicts with the rule-based categorization decision. Preserving legacy first-seen display keeps misleading metadata.
- **Key decisions**: Start the new schema from deployment month; the route tolerates malformed/missing records but does not attempt full legacy migration. Send configuration fails when `KNOWLEDGE_GAP_REPORT_EMAIL` is absent.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Redis record update races under simultaneous identical questions | L | M | Store canonical wording only on first insert and increment count with Redis `incr`. |
| Regex sanitization misses some personal data | M | M | Scope to obvious emails, Australian-looking phones, and long reference-like numbers as agreed for v1. |
| Broader tool calls create more fallback responses | M | M | Update prompt only for visitor information questions and keep fallback response unchanged. |

## Verification
- Unit-test sanitization, exact-normalized aggregation, categories, and route recipient/report sorting.
- Run targeted Vitest files, then lint or broader test command if feasible.
