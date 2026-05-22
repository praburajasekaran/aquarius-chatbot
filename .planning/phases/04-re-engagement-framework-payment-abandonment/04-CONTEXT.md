---
phase: 4
slug: re-engagement-framework-payment-abandonment
status: discussed
created: 2026-05-07
---

# Phase 4 — Discussion Context

> Implementation decisions captured during discuss-phase. Consumed by researcher and planner.

---

## Domain

**What this phase delivers:** A reusable `email-reminders` module that mirrors the v1.0 SMS pattern (two-key idempotency, absent-env graceful degradation), the payment-abandonment email pair (1h hybrid + 24h follow-up), and an HMAC-signed one-click unsubscribe endpoint with a branded confirmation page. Phase 5 (appointment abandonment) and Phase 6 (digest aggregator) consume the framework as-is.

**Phase boundary:** Framework + payment-abandonment flow + unsubscribe + foundational activity log. Appointment abandonment, daily digest aggregator, and happy-path audit are out of scope (later phases).

---

## Canonical Refs

> Files downstream agents (researcher, planner, executor) MUST read.

**Specs / requirements:**
- `.planning/REQUIREMENTS.md` — INFRA-01..07, PAY-01..04, OPS-V1.1-01..02, TEST-V1.1-01 are this phase's locked requirements
- `.planning/ROADMAP.md` — Phase 4 section: file layout, success criteria, mutated existing files
- `.planning/PROJECT.md` — milestone goal + reliability bar ("I only want them to work reliably") that drives the two-key idempotency requirement

**Prior-phase context that carries forward:**
- `.planning/phases/02-qstash-scheduler/02-CONTEXT.md` — establishes the two-key idempotency contract, absent-env warn-and-return discipline, and the inner-handler-extracted-from-`verifySignatureAppRouter` test pattern. Phase 4 reuses ALL three patterns unchanged.
- `.planning/phases/01-dispatch-foundation/` — DCEM/factual tone discipline (COMP-01 sign-off gate) for the SMS module; Phase 4 mirrors this for email copy.

**Codebase reads:**
- `src/lib/sms/reminder.ts` — the v1.0 reference implementation Phase 4's `email-reminders/dispatch.ts` mirrors
- `src/app/api/webhooks/sms-reminder/route.ts` — the v1.0 reference for the inner-handler pattern (`handleReminderDelivery` exported separately, route wraps with `verifySignatureAppRouter`)
- `src/lib/sms/copy.ts` — the v1.0 reference for the DCEM-locked copy + sign-off comment block
- `src/lib/intake/handle-paid.ts` — call-site for `cancelEmailReminder('payment-abandonment-1h' | '-24h', ...)` and `payment-completed:{sessionId}` Redis write
- `src/lib/tools/select-urgency.ts` — call-site for `scheduleEmailReminder('payment-abandonment-1h' | '-24h', ...)` (after `sendClientInquiryEmail`/`sendFirmLeadEmail` succeed; failure must NOT propagate up)
- `src/lib/email/components/` — existing `Logo`, `EmailLayout`, `DataTable`, `BrandButton`, `Footer` components to reuse in new templates
- `src/app/api/checkout/resume/route.ts` — `/api/checkout/resume?session={sessionId}` is the payment-resume target both 1h and 24h emails link to
- `src/lib/kv.ts` — `redis` singleton, existing key namespaces (`session:`, `stripe-session:`, `upload-token:`, `sms-reminder:`, `uploaded:`)
- `src/lib/email/assert-no-tracking.ts` — Resend tracking-off assertion that new templates must respect

---

## Decisions

### 1. Email Copy — Tone, LSS Explainer, Sign-off

**Decision:** Factual / DCEM-strict tone for both 1h hybrid and 24h follow-up. LSS explainer renders as a side-by-side tier table. Locked copy strings carry the same firm-principal-sign-off gate as SMS COMP-01. Plan generates draft copy → user reviews and edits → copy goes to firm principal for sign-off → final-locked version ships. Implementation lands with placeholder strings clearly marked `PENDING_SIGNOFF` until firm sign-off is recorded.

**Why:**
- AU Spam Act 2003 footing: re-engagement email is borderline-commercial; factual service-message framing is the most defensible posture. Mirrors the SMS milestone's stance.
- The reliability bar from PROJECT.md is "I only want them to work reliably" — overly marketing-y framing would invite a different conversation about deliverability and consent that we don't want.
- Side-by-side tier table is more scannable than prose in modern email clients (Gmail, Apple Mail, Outlook web all render `<table>` reliably) and gives the visitor a clear next-step decision.
- COMP-01-style sign-off gate keeps the legal/compliance trail consistent across SMS and email channels.

**Implementation notes:**
- Copy module: `src/lib/email-reminders/copy.ts`
- Top-of-file comment block mirroring `src/lib/sms/copy.ts` lines 1–18 (DCEM classification, no promotional language, sign-off gate, what NOT to add)
- Locked exports (string constants and string-builder functions): subject lines, hybrid 1h body paragraphs, LSS tier-table content (urgent vs non-urgent: price, description, who-it's-for, next-step), 24h follow-up body paragraphs, footer/unsubscribe-CTA text
- Until firm sign-off lands, exports return `PENDING_SIGNOFF` placeholder strings; planner should add a runtime guard that throws in production builds when copy is still `PENDING_SIGNOFF` (fail loud rather than silently send placeholder)
- React Email templates: `src/lib/email/templates/reengagement-payment.tsx` — single template renders both 1h hybrid and 24h follow-up by `variant: '1h' | '24h'` prop

---

### 2. Unsubscribe — UX, Token, Scope

**Decision:** Branded Next.js page at `/unsubscribed` (Aquarius logo + Tailwind brand styles, single confirmation sentence, link back to homepage). HMAC-SHA256 with base64url encoding signs the sessionId only — no expiry on the token. `unsubscribe:{sessionId}` Redis key written with TTL 30 days; gate is enforced at delivery time only (NOT at schedule time). Phase 5 inherits the gate for free.

**Why:**
- A real Next.js page is consistent with the brand visitors saw in the original chat; an inline-HTML response from the API would feel like a different system.
- Token-no-expiry is the most respectful of visitor intent: a stale unsubscribe link clicked years later is still a legitimate opt-out, not abuse. Secret rotation is the kill switch if ever needed.
- 30d TTL on the Redis key is plenty (longest reminder window is 24h with grace) and avoids unbounded key growth. Picking a TTL > 24h+grace also covers the Phase 5 worst case (24h appointment reminder) without re-thinking.
- Delivery-only gate keeps `scheduleEmailReminder()` simple and matches the v1.0 SMS philosophy — defence at the gate, not at every call site.
- HMAC-SHA256 / base64url is the standard form for one-click unsubscribe links; matches what most email infra implements.

**Implementation notes:**
- Unsubscribe module: `src/lib/email-reminders/unsubscribe.ts`
  - `signUnsubscribeToken(sessionId): string` — HMAC-SHA256(EMAIL_REMINDER_UNSUBSCRIBE_SECRET, sessionId), output as base64url
  - `verifyUnsubscribeToken(sessionId, token): boolean` — constant-time compare against re-derived signature
  - Both helpers degrade gracefully when `EMAIL_REMINDER_UNSUBSCRIBE_SECRET` is missing (sign returns null + logs warn; verify returns false + logs warn) — matches OPS-V1.1-01
- API route: `src/app/api/email/unsubscribe/route.ts`
  - GET handler reads `session` and `token` query params
  - Verifies → sets `unsubscribe:{sessionId}` Redis key (`{ ex: 30 * 24 * 3600 }`) → calls `cancelEmailReminder('payment-abandonment-1h' | '-24h', sessionId)` for every v1.1 reminder type (loop through known types) → also writes `logActivity('unsubscribed', sessionId, ...)` per Decision 3 → redirects to `/unsubscribed`
  - On verify failure: returns 400 with a minimal error page (don't leak which sessionIds exist)
- Page: `src/app/unsubscribed/page.tsx` — server component, brand styles, single sentence "You won't receive further reminders for this inquiry from Aquarius Lawyers.", back-to-home link
- Delivery-handler gate (in `src/app/api/webhooks/email-reminder/route.ts`): reads `unsubscribe:{sessionId}` AND the per-type cancellation key (e.g. `payment-completed:{sessionId}`); short-circuits with `email_reminder_skipped` log if either is set

---

### 3. Activity Logging Boundary — Phase 4 Owns the Helper + Wires Phase 4 Events

**Decision:** Ship `src/lib/digest/activity-log.ts` in Phase 4 (NOT Phase 6). Phase 4 wires every Phase 4 event to it: `lead_created` (in `selectUrgency` after `sendClientInquiryEmail`/`sendFirmLeadEmail`), `payment_completed` (in `handlePaid` post-fan-out), `payment_abandoned_1h` and `payment_abandoned_24h` (in the email-reminder delivery handler after successful Resend), `unsubscribed` (in the unsubscribe API route). `logActivity()` is fully isolated — never throws, internal try/catch, console.warn on Redis failure with `event=activity_log_failed`. Phase 6 adds the aggregator + cron + digest template + remaining events (upload_completed, appointment_booked, appointment_abandoned_*).

**Why:**
- Without this decision, every Phase 4 event between ship-Phase-4 and ship-Phase-6 is lost forever — no historical reconstruction is possible from Redis (events aren't stored anywhere else). The first daily digests would silently under-report payment activity.
- The helper is ~30 lines (LPUSH + EXPIRE on `activity:{YYYY-MM-DD-AEST}` with 14d TTL per DIG-01). The cost of pulling it forward is trivial relative to the cost of losing data.
- Full isolation matches the v1.0 SMS dispatch discipline: a logging failure must never break a payment flow, an email send, or a webhook ack. Same cultural rule.

**Implementation notes:**
- File: `src/lib/digest/activity-log.ts`
- API: `logActivity(event: ActivityEvent, sessionId: string, payload?: Record<string, unknown>): Promise<void>`
- `ActivityEvent` type: union of all event names — Phase 4 declares `'lead_created' | 'payment_completed' | 'payment_abandoned_1h' | 'payment_abandoned_24h' | 'unsubscribed'`; Phase 6 extends the union with `'upload_completed' | 'appointment_booked' | 'appointment_abandoned_4h' | 'appointment_abandoned_24h'`
- Internal: `await redis.lpush(\`activity:${aestDate()}\`, JSON.stringify({ event, sessionId, ts, payload }))` then `redis.expire(key, 14 * 24 * 3600)`
- AEST date helper: timezone-aware so the cron-window slicing (Phase 6) lines up correctly
- Wrapped in try/catch; on failure: `console.warn('[activity] log failed', { event: 'activity_log_failed', activityEvent: event, sessionId, err })` — never throws, never propagates
- Tests: a single unit test asserting (a) success path appends + sets TTL, (b) Redis failure path does not throw and emits the warn log

---

### 4. Matter Description in 24h Follow-up — First Sentence / 120 Chars

**Decision:** The 24h payment-abandonment template renders the matter description as either (a) the first sentence (split on `.`, `!`, `?`) or (b) the first 120 characters with ellipsis if no sentence-ending punctuation found. Render inline as a single line ("Re: your inquiry about — {snippet}"), NOT in quotes. Apply this rule independently of how existing templates (`client-inquiry.tsx`, `firm-lead.tsx`) currently render matter content; any inconsistency surfaced is a Phase 6 audit (DIG-06) finding, not Phase 4 scope.

**Why:**
- Visitors paste sensitive content into the matter description (specific charges, dates, locations). Email travels over the open internet. Truncating to first-sentence / 120 chars caps how much sensitive detail gets re-transmitted while preserving enough recognition for the visitor to know which inquiry the email refers to.
- "First sentence" tracks how matters are typically described — the headline issue lands in sentence one; supporting detail follows. The 120-char fallback covers edge cases where the visitor wrote a single long sentence.
- Not quoting the snippet avoids the impression that we're transcribing their message back at them — feels less surveillance-y in the inbox.
- Applying the rule independently of existing templates keeps Phase 4 scope tight; the audit pass already exists in Phase 6 (DIG-06) and is the right place to address consistency across all five happy-path templates.

**Implementation notes:**
- Helper: small utility (e.g. `src/lib/email-reminders/format-matter.ts` or inline in the template) — `function snippetMatter(matterDescription: string): string`
- Logic: regex split on `/[.!?]\s/`; take first segment; if length > 120, return `matterDescription.slice(0, 117) + '...'`; if first-sentence segment is itself > 120, also truncate
- Trim whitespace; collapse internal newlines to spaces (visitors sometimes paste multi-line descriptions)
- 1h hybrid template MAY use the same helper — small consistency win, no extra cost
- No need to escape — React Email handles HTML escaping by default

---

## Code Context

### Reusable Assets (existing, do not modify in Phase 4)

| Asset | Location | Notes |
|-------|----------|-------|
| `redis` singleton | `src/lib/kv.ts:4` | `Redis` from `@upstash/redis`; imported directly |
| `@upstash/qstash` Client | already installed via v1.0 Phase 2 | Reuse the same import pattern as `src/lib/sms/reminder.ts` |
| `verifySignatureAppRouter` | `@upstash/qstash/nextjs` | Wrap the `POST` export with this; export inner handler separately for testing (per Phase 02 pattern) |
| `assertNoResendTracking` | `src/lib/email/assert-no-tracking.ts` | New templates must call/assert this; existing helper |
| Email layout components | `src/lib/email/components/` | `Logo`, `EmailLayout`, `DataTable`, `BrandButton`, `Footer` — reuse for `reengagement-payment.tsx` |
| `BRANDING` | `src/lib/branding.ts` | Brand color, fonts, firm name |
| `FIRM_CONTACT` | `src/lib/contact.ts` | Phone number for footer / sign-off |
| `getIntake` | `src/lib/intake.ts` | Read intake (clientName, clientEmail, matterDescription, urgency) for snippet formatting |
| `/api/checkout/resume` | `src/app/api/checkout/resume/route.ts` | Payment-resume link target — both 1h and 24h templates point here with `?session={sessionId}` |
| Stripe dedup TTL pattern | `src/app/api/webhooks/stripe/route.ts:11` | `DEDUPE_TTL_SECONDS = 60 * 60 * 24 * 7` — use 26h for `payment-completed:{sessionId}` per ROADMAP |

### New Dependencies

- None expected — `@upstash/qstash`, `@upstash/redis`, `resend`, `react-email` all installed via v1.0 + happy-path work.
- HMAC: Node's built-in `crypto.createHmac('sha256', secret)` + base64url encoding (Node 16+ supports `'base64url'` directly). No new package.

### Redis Key Namespaces (Phase 4 additions)

| Prefix | TTL | Owner | Purpose |
|--------|-----|-------|---------|
| `email-reminder:{type}:{sessionId}` | `delaySeconds + 7200` (per INFRA-02) | Phase 4 | Cancel-lookup: stores QStash messageId for `cancelEmailReminder()` |
| `email-reminder-sent:{type}:{sessionId}` | 7d (per INFRA-05) | Phase 4 | Delivery NX dedup: prevents double-send on QStash redeliver |
| `payment-completed:{sessionId}` | 26h (per ROADMAP) | Phase 4 (written in `handlePaid`) | Cancellation-state guard read at delivery time |
| `unsubscribe:{sessionId}` | 30d (per Decision 2) | Phase 4 | Visitor-level opt-out; gate at delivery for ALL v1.1 reminder types |
| `activity:{YYYY-MM-DD-AEST}` | 14d (per DIG-01) | Phase 4 (helper + Phase 4 events); Phase 6 (remaining events + reader) | Per-day activity list for digest aggregator |

### New Files (per ROADMAP, plus this discussion)

- `src/lib/email-reminders/dispatch.ts` — `scheduleEmailReminder()`, `cancelEmailReminder()`
- `src/lib/email-reminders/state.ts` — Redis helpers for the three reminder-key families
- `src/lib/email-reminders/copy.ts` — locked copy (DCEM comment block; PENDING_SIGNOFF placeholders until firm signs off)
- `src/lib/email-reminders/unsubscribe.ts` — HMAC sign + verify
- `src/lib/email-reminders/format-matter.ts` *(or inline)* — first-sentence/120-char snippet helper
- `src/lib/email-reminders/__tests__/dispatch.test.ts` — unit tests for schedule, cancel, NX dedup, unsubscribe HMAC, absent-env graceful degradation, activity-log isolation
- `src/lib/email/templates/reengagement-payment.tsx` — single template, `variant: '1h' | '24h'` prop
- `src/app/api/webhooks/email-reminder/route.ts` — QStash delivery target with signature verification + cancel/unsub gate (extract inner handler per Phase 02 pattern)
- `src/app/api/email/unsubscribe/route.ts` — one-click unsubscribe endpoint
- `src/app/unsubscribed/page.tsx` — branded confirmation page *(added by this discussion)*
- `src/lib/digest/activity-log.ts` — `logActivity()` helper, fully isolated *(added by this discussion)*

### Mutated Existing Files

- `src/lib/tools/select-urgency.ts` — add 2× `scheduleEmailReminder()` calls AFTER `sendClientInquiryEmail`/`sendFirmLeadEmail` succeed; failure-isolated; also `logActivity('lead_created', ...)`
- `src/lib/intake/handle-paid.ts` — add 2× `cancelEmailReminder('payment-abandonment-*', ...)` + write `payment-completed:{sessionId}` Redis key + `logActivity('payment_completed', ...)`

---

## Risks & Open Questions

1. **Inquiry-email failure → reminder-still-scheduled** — PAY-01 says reminder scheduling MUST NOT block inquiry email. The corollary: if inquiry email fails but reminder scheduling succeeds, visitor receives a 1h reminder for an inquiry they were never confirmed for. Acceptable risk (rare, and the visitor is expecting an email anyway), but planner should ensure ordering is `inquiry email FIRST, schedule SECOND` so the more visible failure happens first.
2. **`PENDING_SIGNOFF` runtime guard placement** — needs to throw in production but not in tests/dev. Planner should pick the cleanest seam (env check? build-time replacement? a `if (process.env.NODE_ENV === 'production' && copy === PENDING_SIGNOFF) throw` in the dispatcher?).
3. **Token format for unsubscribe link in plain-text fallback** — base64url is URL-safe so no encoding gotchas, but if any email client strips the `?` query string we lose unsubscribe. Should be a non-issue with modern clients. Not blocking.
4. **AEST date helper edge case** — Phase 4's `logActivity()` writes to `activity:{YYYY-MM-DD-AEST}`. The TZ-aware date helper needs to handle DST transitions (AEST/AEDT). Researcher should confirm Upstash Redis is okay with daily-keyed lists at this volume (yes, it is — this is standard).

---

## Deferred Ideas

These were raised as scope-creep candidates and pushed out of Phase 4. None require any action now; capturing so we don't lose them.

- **Audit existing `client-inquiry.tsx` / `firm-lead.tsx` matter rendering** — already covered by DIG-06 (Phase 6 audit pass).
- **Per-firm-user digest preferences** — already deferred to v2 in REQUIREMENTS.md (DIG-V2-01).
- **Token expiry** — explicitly rejected in Decision 2; reconsider only if abuse signal emerges.
- **Schedule-time unsubscribe gate** — explicitly rejected in Decision 2; reconsider only if QStash schedule cost becomes a concern.

---

## Folded Todos

None — `gsd-sdk query todo.match-phase` not available in this environment; user did not surface external todos.

---

*Context created: 2026-05-07*
*Phase 4 discuss-phase complete — ready for `/gsd-plan-phase 4` (or `/gsd-plan-phase 4 --skip-research` if existing v1.0 research suffices).*
