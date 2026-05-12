---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: planned
last_updated: "2026-05-12T00:00:00.000Z"
progress:
  total_phases: 3
  completed_phases: 2
  total_plans: 6
  completed_plans: 4
---

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

Phase: 03 (provider-agnostic-seam) — PLANNED
Plan: 2 of 2 (planning complete)

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases total | 3 |
| Phases complete | 2 |
| Requirements total | 22 |
| Requirements complete | 11 |
| Session started | 2026-04-24 |

## Performance Metrics (Execution Log)

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 01-dispatch-foundation P01 | 2m | 3 tasks | 5 files |
| Phase 01-dispatch-foundation P02 | 2m | 2 tasks | 2 files |
| Phase 02-qstash-scheduler P01 | 10m | 2 tasks | 3 files |
| Phase 02-qstash-scheduler P02 | 2m | 2 tasks | 3 files |

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
| No @vitejs/plugin-react in plan 01 | Node-environment tests don't need the React plugin; avoids unnecessary dependency for plan 01 scope |
| libphonenumber-js in dependencies not devDependencies | Will be imported at runtime by dispatch.ts in plan 02; it is a production dependency |
| FIRM_NAME hardcoded as literal in copy.ts | BRANDING.firmName defaults to 'Demo Law Firm' when NEXT_PUBLIC_FIRM_NAME unset; DCEM-locked copy must be deterministic across all environments |
| libphonenumber-js/min subpath resolves correctly | No fallback to plain libphonenumber-js was needed; /min subpath confirmed present under Next.js 16 bundler moduleResolution |
| redact() preserves +61 prefix then masks middle digits | Produces +61*****5678 pattern matching /+61\*+5678/ regex in test 4 |
| Two-key dedup design for SCHED-05 | sms-reminder:{sessionId} stores messageId for cancel-lookup; sms-reminder-sent:{sessionId} NX for handler delivery dedup — separate keys prevent cancel-lookup from being overwritten by dedup write |
| @upstash/qstash installed as production dependency | Runtime import by reminder.ts and route.ts; same vendor as @upstash/redis already in project |
| Upload guard uses uploaded:{sessionId} Redis key not getSession() | Session TTL=1h is too short for 24h reminder window; durable Redis key is the only reliable signal |
| verifySignatureAppRouter wraps handleReminderDelivery as POST export | Structural SCHED-02 compliance; signing key reads happen at request time inside the HOC |
| `handleIntakePaid()` already implements most of Phase 3 | Code discovery during planning found the orchestrator already exists at 324 lines with full fan-out (SMS, email, upload tokens, firm notify). Only sms-immediate NX dedup and in-chat upload cancel are missing. |

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

Next action: Execute Phase 03 (2 plans: sms-immediate NX dedup + upload cancel hook, then integration tests)

---

*State initialized: 2026-04-24*
*Last updated: 2026-05-12 after planning phase 03 (provider-agnostic-seam)*
