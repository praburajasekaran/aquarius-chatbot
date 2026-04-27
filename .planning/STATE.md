# Project State: Aquarius Lawyers Chatbot — ClickSend SMS Integration

---

## Project Reference

**Core Value:** Paying clients reliably get their documents to the firm — because their mobile buzzed, not because they happened to check an email.
**Project file:** `.planning/PROJECT.md`
**Requirements:** `.planning/REQUIREMENTS.md` (22 v1 requirements)
**Roadmap:** `.planning/ROADMAP.md` (3 phases)
**Architecture:** `.planning/research/ARCHITECTURE.md`
**Pitfalls:** `.planning/research/PITFALLS.md`

---

## Current Position

**Current Phase:** Not started
**Current Plan:** None
**Status:** Roadmap created; awaiting first plan
**Progress:** 0/3 phases complete

```
[          ] Phase 1: Dispatch Foundation
[          ] Phase 2: QStash Scheduler
[          ] Phase 3: Provider-Agnostic Seam
```

---

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases total | 3 |
| Phases complete | 0 |
| Requirements total | 22 |
| Requirements complete | 0 |
| Session started | 2026-04-24 |

---

## Accumulated Context

### Key Decisions Made

| Decision | Rationale |
|----------|-----------|
| 3-phase coarse structure | ~1-day feature; phases align with merge-safety boundaries (phases 1-2 are new-files-only, phase 3 mutates existing files) |
| QStash for 24h reminder, not Vercel Cron | Fires exactly once at the right time; cancellable by ID; no Redis scan needed; same Upstash vendor as existing Redis |
| `handleIntakePaid()` as the single seam | Bpoint migration is in-flight in a parallel worktree; coupling SMS to Stripe types guarantees merge conflicts |
| `fetch` only for ClickSend, no SDK | Consistent with existing Zapier/Resend pattern; ClickSend REST surface for a single send is 3 fields |
| Landline detection pre-API, not post-response | ClickSend does not return carrier type synchronously; AU mobile prefix check is sufficient and testable |
| Absent-safe env var pattern | App must boot and function without `CLICKSEND_*` or `QSTASH_*` vars for local dev and PR previews |

### Critical Constraints to Remember

- **DCEM compliance**: SMS copy must be factual only — no promotional language. Any copy change requires firm principal sign-off. Lock as named constant in `copy.ts`.
- **ACMA Sender ID deadline**: Alphanumeric sender IDs must be registered via ClickSend by 15 May 2026 or they show as "Unverified" from 1 July 2026. Confirm registration status before any production send.
- **Phase 3 is the only phase that mutates existing files**: `src/app/api/webhooks/stripe/route.ts`, `src/app/api/late-upload/session/route.ts`. Phases 1 and 2 are independently mergeable.
- **E.164 mandatory**: `normalizePhone()` in `validators.ts` does NOT produce E.164. Always convert via `toE164AU()` before hitting ClickSend.
- **Dedup keys**: `sms-immediate:{sessionId}` (NX, phase 3) and `sms-reminder:{sessionId}` (NX, phase 2) are the send-locks. These are separate from the Stripe dedup key.

### Pitfalls to Watch

- Pitfall 1: DCEM vs commercial message misclassification — locked copy constant mitigates this
- Pitfall 2: Phone not in E.164 format — `toE164AU()` in phase 1 mitigates this
- Pitfall 3: Duplicate SMS on Stripe retry — `sms-immediate` Redis NX key in phase 3 mitigates this
- Pitfall 4: 24h reminder race with late upload — upload-state check in reminder handler (phase 2) + cancel hook (phase 3)
- Pitfall 5: SMS dispatch coupled to Stripe types — `IntakePaidEvent` seam in phase 3 mitigates this
- Pitfall 6: ACMA Sender ID Register deadline — operational task; confirm with firm before production deploy

### Files Not to Touch Until Phase 3

- `src/app/api/webhooks/stripe/route.ts`
- `src/app/api/late-upload/session/route.ts`
- `src/lib/upload-tokens.ts`
- `src/lib/intake.ts`
- `src/lib/kv.ts`

### Todos

- [ ] Confirm with firm principal whether ACMA Sender ID (`AquariusLaw` or chosen string) is already registered via ClickSend
- [ ] Obtain firm principal written sign-off on SMS copy before any production send
- [ ] Add `CLICKSEND_USERNAME`, `CLICKSEND_API_KEY`, `CLICKSEND_SENDER_ID`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, `APP_URL` to Vercel production environment (production only; not preview)

### Blockers

None currently.

---

## Session Continuity

To resume work, read:
1. This file (`STATE.md`) — current position and decisions
2. `ROADMAP.md` — phase goals and success criteria
3. The current phase's plan file (`.planning/plans/phase-N-*.md`) when created

Next action: `/gsd:plan-phase 1`

---

*State initialized: 2026-04-24*
*Last updated: 2026-04-24 after roadmap creation*
