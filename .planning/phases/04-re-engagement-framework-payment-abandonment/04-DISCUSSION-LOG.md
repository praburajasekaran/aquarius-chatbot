---
phase: 4
slug: re-engagement-framework-payment-abandonment
log_type: discussion
created: 2026-05-07
---

# Phase 4 — Discussion Log

> Human-readable record of the discuss-phase Q&A. Not consumed by downstream agents (researcher, planner, executor read CONTEXT.md instead). Kept for audit + retrospective.

---

## Gray Areas Selected

User selected all four areas presented:

1. Email copy & sign-off process
2. Unsubscribe UX, token expiry & scope
3. Activity logging boundary (Phase 4 vs Phase 6)
4. Matter description in 24h follow-up email

---

## Area 1 — Email Copy & Sign-off Process

### Q1.1 — Tone register for the 1h hybrid nudge

**Options:**
- Factual / DCEM-strict (mirror SMS COMP-01 stance) *(Recommended)*
- Warm-nudge (slightly softer than SMS)
- Standard re-engagement marketing

**Selection:** Factual / DCEM-strict

**Rationale captured:** Spam Act 2003 footing + reliability bar from PROJECT.md ("I only want them to work reliably") both push toward factual service-message framing.

### Q1.2 — LSS explainer block format

**Options:**
- Side-by-side tier table *(Recommended)*
- Two short paragraphs
- Single paragraph + link to firm site

**Selection:** Side-by-side tier table

**Rationale captured:** More scannable in modern email clients; gives visitor a clear next-step decision; renders reliably in Gmail / Apple Mail / Outlook web.

### Q1.3 — Sign-off gate

**Options:**
- Same gate as SMS COMP-01 *(Recommended)*
- No gate — dev edits freely
- Soft gate — sign-off only on subject lines

**Selection:** Same gate as SMS COMP-01

**Rationale captured:** Keeps legal/compliance trail consistent across SMS and email channels; matches the firm's existing posture for service-message copy.

### Q1.4 — Authorship workflow

**Options:**
- Plan generates draft → user reviews/edits → ship to firm *(Recommended)*
- User drafts copy first, then plan-phase
- Defer copy entirely — ship plumbing only

**Selection:** Plan generates draft → user reviews/edits → ship to firm

**Rationale captured:** Avoids blocking on copywriting; planner can produce a defensible first draft that the user trims to taste before firm sign-off.

---

## Area 2 — Unsubscribe UX, Token Expiry & Scope

### Q2.1 — Confirmation page format

**Options:**
- Branded Next.js page at `/unsubscribed` *(Recommended)*
- Inline HTML response from API
- Redirect to homepage with `?unsubscribed=1`

**Selection:** Branded Next.js page at `/unsubscribed`

**Rationale captured:** Brand consistency with the chat experience; easier to evolve than inline HTML.

### Q2.2 — HMAC token expiry

**Options:**
- No expiry — sessionId-only signed *(Recommended)*
- 30-day expiry
- Tied to intake-window expiry (7d)

**Selection:** No expiry — sessionId-only signed

**Rationale captured:** Most respectful of visitor intent; secret rotation is the kill switch if ever needed; simpler to verify.

### Q2.3 — Unsubscribe key TTL & cross-phase scope

**Options:**
- 30-day TTL; gate at delivery only *(Recommended)*
- 30-day TTL; gate at schedule AND delivery
- Permanent (no TTL); delivery-only gate

**Selection:** 30-day TTL; gate at delivery only

**Rationale captured:** Defence at the gate matches v1.0 SMS philosophy; 30d covers worst-case Phase 5 reminder window with margin; keeps schedule logic simple; Phase 5 inherits the gate for free.

### Q2.4 — Hash algorithm and link format

**Options:**
- HMAC-SHA256, base64url-encoded, in query string *(Recommended)*
- HMAC-SHA256, hex-encoded
- JWT (signed, no exp)

**Selection:** HMAC-SHA256, base64url-encoded, in query string

**Rationale captured:** Standard form for one-click unsubscribe links; URL-safe encoding; no extra dependencies (Node built-in `crypto`).

---

## Area 3 — Activity Logging Boundary

### Q3.1 — Where the boundary sits

**Options:**
- Land `logActivity()` in Phase 4; wire Phase 4 events now *(Recommended)*
- Defer entirely to Phase 6; accept event loss
- Land helper but wire zero events

**Selection:** Land `logActivity()` in Phase 4; wire Phase 4 events now

**Rationale captured:** Without this, every Phase 4 event between ship-Phase-4 and ship-Phase-6 is lost forever; the helper is ~30 lines so the cost of pulling it forward is trivial relative to the cost of losing data.

**Phase 4 events wired:** `lead_created` (in `selectUrgency`), `payment_completed` (in `handlePaid`), `payment_abandoned_1h` and `payment_abandoned_24h` (in delivery handler after Resend success), `unsubscribed` (in unsubscribe API route).

**Phase 6 will add:** `upload_completed`, `appointment_booked`, `appointment_abandoned_4h`, `appointment_abandoned_24h`, plus the aggregator + cron + digest template.

### Q3.2 — Failure isolation for `logActivity()`

**Options:**
- Fully isolated — always swallows + warns *(Recommended)*
- Throws on Redis failure; call sites wrap

**Selection:** Fully isolated — always swallows + warns

**Rationale captured:** Same discipline as v1.0 SMS dispatch — a logging failure must never break a payment flow, an email send, or a webhook ack.

---

## Area 4 — Matter Description in 24h Follow-up

### Q4.1 — Render strategy

**Options:**
- First sentence (or first 120 chars), no quotes *(Recommended)*
- Verbatim full text
- Category + urgency tier only
- No matter reference at all

**Selection:** First sentence (or first 120 chars), no quotes

**Rationale captured:** Caps re-transmission of sensitive content over the open internet while preserving enough recognition for the visitor; not quoting avoids surveillance-y feel; first-sentence tracks how matters are typically described.

### Q4.2 — Existing email parity check

**Options:**
- Apply new rule independently *(Recommended)*
- Match existing pattern (whatever it is)
- First-sentence rule + flag existing templates for Phase 6 audit

**Selection:** Apply new rule independently

**Rationale captured:** Phase 6 (DIG-06) already covers the audit pass on existing five happy-path templates; that's the right place to address consistency. Phase 4 stays scope-tight.

---

## Deferred Ideas

Captured during discussion; not acted on:

- **Audit `client-inquiry.tsx` / `firm-lead.tsx` matter rendering** — covered by DIG-06 (Phase 6).
- **Per-firm-user digest preferences** — already deferred to v2 (DIG-V2-01).
- **Token expiry on unsubscribe** — explicitly rejected; revisit only if abuse signal emerges.
- **Schedule-time unsubscribe gate** — explicitly rejected; revisit only if QStash schedule cost becomes a concern.

---

## Claude's Discretion (Not Asked)

These were handled per locked patterns from REQUIREMENTS.md, ROADMAP.md, or v1.0 prior context — not surfaced as gray areas:

- Two-key idempotency contract (cancel-lookup + delivery NX) — locked by INFRA-05/06 + Phase 02 CONTEXT.md
- Absent-env graceful degradation discipline — locked by OPS-V1.1-01 + v1.0 SMS reference impl
- Inner-handler-extracted-from-`verifySignatureAppRouter` test pattern — locked by Phase 02 CONTEXT.md decision 3
- File layout under `src/lib/email-reminders/` and template under `src/lib/email/templates/` — locked by ROADMAP "New files" section
- Redis key naming for the new namespaces — locked by INFRA-02 / INFRA-04 / INFRA-05 wording in REQUIREMENTS.md
- Reuse of `/api/checkout/resume?session={id}` for payment-resume links — already exists in codebase (`src/app/api/checkout/resume/route.ts`)
- Order of side-effects in `handle-paid.ts` — established by existing fan-out pattern (idempotency guard FIRST, then receipt + transcript + SMS, then now: cancel reminders + write `payment-completed` key + log activity)

---

*Discussion completed: 2026-05-07*
