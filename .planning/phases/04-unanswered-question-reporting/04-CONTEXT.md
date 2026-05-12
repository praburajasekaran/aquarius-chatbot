# Phase 04: Unanswered Question Reporting — Context

**Gathered:** 2026-05-12
**Status:** Ready for planning
**Goal:** Monthly email report of unanswered questions to the Aquarius team

---

## Problem

When visitors ask questions not covered by the criminal-law knowledge base, the chatbot returns a polite fallback and offers to book a session. But the firm has no visibility into **what** visitors are asking about — the questions are discarded. Over time, these represent the highest-value signal for expanding the knowledge base.

## Solution

1. **Log** every unmatched question to Redis when `matchQuestion` returns no match
2. **Aggregate** monthly via a Vercel Cron job
3. **Email** a report to the firm (`FIRM_NOTIFY_EMAIL`) with the unanswered questions

## Implementation Approach

### New Files
- `src/lib/tools/log-unanswered.ts` — `logUnanswered(question: string, sessionId: string): Promise<void>` — ZADD to `unanswered:{YYYY-MM}` sorted set
- `src/lib/email/templates/unanswered-report.tsx` — React email template listing questions
- `src/app/api/cron/unanswered-report/route.ts` — Vercel Cron handler: read last month's sorted set, build email, send via Resend

### Modified Files
- `src/lib/tools/match-question.ts` — add `logUnanswered()` call when `matched: false`
- `vercel.json` — add cron job entry

### Dependencies
- No new packages. Uses existing `@upstash/redis`, `resend`, `@react-email/components`.
- Vercel Cron is a platform feature, not an npm dependency.

## Requirements

| REQ-ID | Description | Status |
|--------|-------------|--------|
| REPORT-01 | Unmatched question logged to Redis sorted set | ❌ Missing |
| REPORT-02 | Monthly Vercel Cron compiles and emails report | ❌ Missing |
| REPORT-03 | Report email lists unique unanswered questions | ❌ Missing |
| REPORT-04 | Redis-unavailable degrades gracefully | ❌ Missing |
| REPORT-05 | Duplicate questions deduplicated within month | ❌ Missing |

## Files

### New
- `src/lib/tools/log-unanswered.ts`
- `src/lib/email/templates/unanswered-report.tsx`
- `src/app/api/cron/unanswered-report/route.ts`

### Modified
- `src/lib/tools/match-question.ts`
- `vercel.json`

## Success Criteria

1. Asking a question not in the knowledge base results in a Redis `ZADD` to `unanswered:{YYYY-MM}` — verified by integration test
2. The cron endpoint at `GET /api/cron/unanswered-report` returns 200 and sends an email to `FIRM_NOTIFY_EMAIL` — verified in staging
3. The report email contains all unique unanswered questions from the prior month, sorted chronologically
4. The app boots and `matchQuestion` functions normally when Redis is unavailable — `logUnanswered` catches and swallows errors
5. Asking the same question twice in a month results in one entry in the sorted set (ZADD idempotency)

---

*Phase: 04-unanswered-question-reporting*
*Context gathered: 2026-05-12*
