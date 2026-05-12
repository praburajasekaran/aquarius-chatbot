# Phase 04: Unanswered Question Reporting — Research

**Researched:** 2026-05-12
**Status:** Complete

---

## Domain Research

### Current Knowledge Base Gap Handling

The `matchQuestion` tool (`src/lib/tools/match-question.ts`) uses keyword-overlap scoring against 66 Q&A pairs in `src/lib/knowledge-base/criminal-law.json`. When no pair scores ≥3, it returns `{ matched: false, fallback: true }`. The system prompt then delivers a hardcoded fallback:

> "That's a great question. While I can help with many common criminal law queries, this one would be best answered by one of our lawyers directly. Would you like to book a Legal Strategy Session so we can address your specific situation?"

The original question is **discarded** after the turn — no logging, no storage, no analytics.

### Redis Storage Pattern

The project uses Upstash Redis (`@upstash/redis`) via `src/lib/kv.ts`. Existing patterns:
- Session data: key-value with 1h TTL
- Intake records: key-value with 7d TTL
- Dedup keys: NX SET with 7d TTL (`stripe-session:`, `sms-immediate:`, `sms-reminder:`)
- Upload flags: simple SET with 26h TTL

For unanswered questions, a **sorted set** is the right structure:
- Key: `unanswered:{YYYY-MM}` (monthly bucketing)
- Member: normalized question text (lowercased, trimmed, punctuation-stripped)
- Score: Unix timestamp (for chronological ordering)

Sorted set benefits:
- `ZADD` with NX semantics prevents duplicates (same normalized text is same member)
- `ZCARD` gives count instantly
- `ZRANGE` with scores gives time-ordered listing
- Monthly bucketing allows automatic cleanup (set TTL on each key)

### Scheduling Options

| Option | Pros | Cons |
|--------|------|------|
| Vercel Cron (`vercel.json` crons) | Built into platform, no new deps, free tier includes 1 cron | Max 1hr timeout; monthly is well within limits |
| QStash scheduled | Already in project, cancellable | Overkill for monthly; adds cost per schedule |
| Manual API endpoint | Simplest | Requires external trigger |

**Decision: Vercel Cron.** Monthly cadence is a perfect fit for Vercel Cron's model. No new dependencies. The cron job calls a `GET /api/cron/unanswered-report` endpoint that aggregates and sends the email.

### Email Integration

Resend is already integrated via `src/lib/resend.ts` with `sendAndLog()` as the single chokepoint. Existing firm notification emails go to `FIRM_NOTIFY_EMAIL`. The new report follows the same pattern:
- React email template using `@react-email/components`
- Reuses `EmailLayout` and `styles` from `src/lib/email/`
- Sent via `sendAndLog()` with structured logging

### Deduplication Strategy

Within a month, the same question (normalized) should only appear once in the report. The sorted set's member uniqueness handles this naturally — `ZADD` with the same member just updates the score (timestamp). This means:
- First occurrence sets the member + timestamp
- Subsequent identical questions update the timestamp to latest
- The count reflects unique questions, not total occurrences

To also track frequency (how many times each question was asked), use a companion structure: `unanswered-count:{YYYY-MM}` hash where field = normalized text, value = count. This is optional — v1 can just show unique questions.

### Security

- No PII in unanswered questions — the question text is what the visitor typed, which may contain names or case details
- Questions are stored in Redis with the same 7d TTL as intake records
- The cron endpoint must be secured: either Vercel Cron's `Authorization` header (from `CRON_SECRET` env var) or the built-in `vercel.json` cron protection

### Failure Modes

- **Redis unavailable**: `ZADD` fails silently — `matchQuestion` continues to return the fallback, the visitor experience is unchanged
- **Cron fails**: No report sent that month, questions accumulate but TTL eventually cleans them
- **Resend fails**: `sendAndLog` throws, cron endpoint returns 500, Vercel Cron retries once
- **No unanswered questions**: Report email contains "No unanswered questions this month" and still sends

---

## Requirements Defined

| REQ-ID | Description |
|--------|-------------|
| REPORT-01 | When `matchQuestion` returns no match, the normalized question text is stored in a Redis sorted set `unanswered:{YYYY-MM}` with the current timestamp as score |
| REPORT-02 | A Vercel Cron job triggers monthly (1st of month, 9am AEST) to compile and email the report |
| REPORT-03 | The report email lists all unique unanswered questions from the prior month, grouped by inferred category where possible |
| REPORT-04 | Question storage degrades gracefully — if Redis is unavailable, `matchQuestion` continues to return the fallback response without error |
| REPORT-05 | Duplicate questions (normalized text match) within a month update the timestamp but do not create duplicate entries |

---

*Research completed: 2026-05-12*
