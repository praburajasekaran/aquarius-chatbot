# Aquarius Lawyers Chatbot

## What This Is

The Aquarius Lawyers chatbot — a Next.js App Router app that converses with prospective clients, matches questions against a curated criminal-law Q&A base, captures intake details, takes payment via Stripe, pushes files into the firm's Smokeball matter via Zapier, and notifies firm and client at each lifecycle stage.

This file evolves milestone-by-milestone. The codebase artefacts in `.planning/codebase/` (mapped 2026-04-24) are the authoritative read for architecture, conventions, integrations, and known concerns.

## Current Milestone: v1.1 Lifecycle Email Flow + Re-engagement

**Goal:** Recover drop-off revenue with humane, cancellable email reminders, and consolidate firm awareness into a single morning digest instead of per-event noise.

**Target features:**
- Payment-abandonment re-engagement (1h hybrid nudge + LSS explainer; 24h follow-up nudge)
- Appointment-booking-abandonment re-engagement (4h + 24h, non-urgent only)
- Generalised email-reminder framework reusing v1.0's QStash + Redis patterns
- Two-key idempotency (cancel-lookup + delivery NX) for every reminder
- One-click courtesy unsubscribe that cancels all v1.1 reminders for the session
- Daily 9am AEST firm digest covering overnight leads, payments, uploads, bookings, abandonments, unsubscribes
- Audit pass on existing five happy-path emails to confirm content matches the lifecycle diagram

## Previous Milestone: v1.0 ClickSend SMS Integration (PARTIALLY SHIPPED)

**Status:** Phases 1–2 complete (2026-04-27); Phase 3 (provider-agnostic seam: `handleIntakePaid()` + Stripe webhook refactor + integration tests) is **deferred** to a future cycle. Artefacts archived at `.planning/milestones/v1.0/REQUIREMENTS.md` and `.planning/milestones/v1.0/ROADMAP.md`. Existing phase directories `.planning/phases/01-dispatch-foundation/` and `.planning/phases/02-qstash-scheduler/` remain in place.

**Why deferred:** v1.1 hooks directly into existing [src/lib/intake/handle-paid.ts](src/lib/intake/handle-paid.ts) and [src/lib/tools/select-urgency.ts](src/lib/tools/select-urgency.ts) seams. The provider-agnostic rename can land in a later milestone without blocking re-engagement work.

## Core Value

Every visitor who shows intent gets a humane chance to convert; every paying client reaches a complete handoff to the firm; the firm sees one coherent morning summary instead of inbox noise.

## Requirements

### Validated

<!-- Capabilities the existing codebase already provides and v1.1 builds on top of. -->

- ✓ Chatbot conversation with intake capture (name, email, AU-validated phone, matter category, urgency) — `src/lib/tools/collect-details.ts`, `src/lib/validators.ts`
- ✓ Static criminal-law Q&A knowledge base with LLM matcher — `src/lib/knowledge-base/criminal-law.json`, `src/lib/tools/match-question.ts`
- ✓ Stripe-based payment + upload-token issuance on success — `src/app/api/webhooks/stripe/route.ts`, `src/lib/upload-tokens.ts`
- ✓ Post-payment transactional email to client (receipt, upload link) and firm (transcript) — `src/lib/resend.ts`, `src/lib/email/*`
- ✓ Pre-payment client inquiry email + firm "lead awaiting payment" notification on `selectUrgency` — `src/lib/tools/select-urgency.ts`
- ✓ Calendly booking webhook → firm booking-confirmation email — `src/app/api/webhooks/calendly/route.ts`
- ✓ Late-upload endpoint that validates token, accepts files, pushes to Smokeball via Zapier — `src/app/api/late-upload/session/route.ts`, `src/lib/late-upload/handle-completed.ts`
- ✓ Session + intake + upload-token storage in Upstash Redis — `src/lib/kv.ts`, `src/lib/intake.ts`, `src/lib/upload-tokens.ts`
- ✓ Unified React Email layout (Logo, EmailLayout, DataTable, BrandButton, Footer) — `src/lib/email/components/*`
- ✓ ClickSend SMS dispatch module with E.164 normalisation, landline detection, locked DCEM copy — `src/lib/sms/dispatch.ts`, `src/lib/sms/copy.ts` *(v1.0 Phase 1)*
- ✓ QStash 24h delayed reminder for SMS upload-nudge — `src/lib/sms/reminder.ts`, `src/app/api/webhooks/sms-reminder/route.ts` *(v1.0 Phase 2)*

### Active

<!-- v1.1 hypotheses. Validated when shipped and we observe: (a) measurable lift in payment-completion within 24h of intake, (b) measurable lift in Calendly-booking within 24h of upload, (c) firm reports the digest is more useful than per-event pings. -->

- [ ] Visitor who completes intake but doesn't pay receives a hybrid nudge + LSS explainer email at 1h, and a follow-up nudge at 24h — both cancelled if they pay before the timer fires
- [ ] Non-urgent visitor who pays + uploads but doesn't book an appointment receives a Calendly-prefilled email at 4h and 24h — both cancelled if they book before the timer fires
- [ ] Urgent visitors are never scheduled for appointment-abandonment reminders (they call the firm directly; both urgent and non-urgent leads continue to flow into Smokeball via existing Zapier)
- [ ] Reminder emails carry a courtesy "no longer interested" link; clicking it cancels all pending v1.1 reminders for that session and is honoured at delivery time
- [ ] Every cancellable reminder uses the two-key idempotency pattern from v1.0: cancel-lookup (`*-completed:{sessionId}`) plus delivery dedup (`*-reminder-sent:{sessionId}` NX)
- [ ] Firm receives a single 9am AEST daily digest summarising the previous 24h of leads, payments, uploads, bookings, abandonments, and unsubscribes — replaces per-event pings for abandonment events; existing happy-path firm emails (lead, transcript, booking) remain unchanged
- [ ] All v1.1 reminder code degrades gracefully when `QSTASH_*` env vars are missing — schedule calls log a structured warning and return without throwing; the app continues to function

### Out of Scope

- **v1.0 Phase 3 (provider-agnostic seam)** — Deferred to a future milestone. v1.1 hooks into existing `handlePaid` and `selectUrgency` seams directly. — *Avoid coupling milestone delivery to in-flight infrastructure refactor.*
- **Doc-upload email reminder** — v1.0 SMS already covers this at 24h; adding an email reminder would triple-message the same drop-off. — *Channel discipline; cost containment.*
- **Per-event firm alert for payment abandonment / appointment abandonment** — Replaced by the daily digest. Firm acts on the digest, not pings. — *Inbox noise reduction.*
- **Pushing pre-payment abandonment leads to Smokeball as "open lead"** — Smokeball remains a paid-leads-only system of record (status quo). Abandonment visibility is digest-only. — *Avoids polluting the firm's matter list with non-paying inquiries.*
- **Inbound email reply handling for unsubscribe** — Unsubscribe is one-click via signed link; no inbox to monitor. — *Operational simplicity; matches the SMS milestone's one-way-only stance.*
- **Behavioural change to existing five happy-path emails** — Audited only; content stays unless the audit surfaces a bug. — *Scope containment.*
- **Business-hour deferral for reminder dispatch** — Calendly enforces slot validity; visitor reads on their schedule; no need to delay sends to office hours. — *Decided 2026-05-07 in milestone questioning.*
- **Multi-channel preference (visitor opts SMS vs email)** — Channel-per-stage is fixed by design (email for slow-decision actions, SMS for fast actions). — *Defer; v2 if signal emerges that a meaningful subset prefers the other channel.*
- **Multiple reminder escalations beyond the locked cadence** — Payment is 1h+24h, appointment is 4h+24h. Adding a third touch crosses into pestering. — *Decided 2026-05-07.*

## Context

- **Brownfield**. Codebase mapped 2026-04-24; artefacts in `.planning/codebase/`. Key reads: `ARCHITECTURE.md`, `INTEGRATIONS.md`, `CONCERNS.md`.
- **Two milestones overlap**: v1.0 SMS Phase 3 is deferred but its Phases 1–2 (dispatch module + QStash reminder) are **shipped and depended on by v1.1**. v1.1 reuses the QStash client, signature-verification middleware, and the two-key Redis idempotency pattern.
- **No new external integrations**: v1.1 is pure email + scheduler glue on top of existing Resend, Upstash Redis, and Upstash QStash.
- **Geography / regulation**: AU clients only. Re-engagement emails are arguably borderline-commercial under Spam Act 2003 — including a one-click courtesy unsubscribe is a defensive design choice, not a strict legal requirement.
- **Reliability bar**: User directive — "I only want them to work reliably." Drives the two-key idempotency requirement, defence-in-depth state checks at delivery time, and graceful degradation when env vars are absent.
- **Smokeball flow unchanged**: paid leads continue to push to Smokeball via the existing Zapier integration in `handlePaid`. v1.1 adds no Smokeball calls.

## Constraints

- **Tech stack**: Next.js App Router + TypeScript + Vercel + Resend + Upstash Redis + Upstash QStash. No new runtime, no new vendor. — *Stack continuity; reuse v1.0 patterns.*
- **Dependencies**: No new heavy SDKs. Continue using `fetch` for ClickSend, `@upstash/qstash` for scheduling, `@upstash/redis` for state, `resend` + `@react-email/components` for email rendering. — *Bundle and maintenance discipline.*
- **Idempotency mandate**: Every cancellable reminder uses the two-key pattern (cancel-lookup + delivery NX). Single-key shortcuts caused real bugs in v1.0 and are not acceptable. — *Lessons learned from v1.0 SCHED-05.*
- **Absent-safe env vars**: App must boot and function with `QSTASH_*` and any new v1.1 env vars missing — schedule calls log + return; reminders degrade silently to no-op. — *Local dev + PR previews.*
- **Security**: Unsubscribe links must be signed (HMAC over sessionId) so a leaked URL can't disable a third party's reminders. — *Standard one-click-unsubscribe security model.*
- **No promotional copy**: Re-engagement emails are factual + transactional + LSS-explanatory. No marketing language, no promotional offers, no urgency manipulation. — *DCEM safe-harbour mindset carried over from v1.0 SMS copy.*
- **Compatibility**: All v1.1 changes must merge cleanly with the in-flight v1.0 Phase 3 work in a different worktree. v1.1 hooks into the *current* `handlePaid` and `selectUrgency` seams; if Phase 3 lands first, v1.1 callers get the rename mechanically without behavioural change. — *Worktree-discipline.*

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Defer v1.0 Phase 3 (provider-agnostic seam) and ship v1.1 against existing `handlePaid` / `selectUrgency` seams | User directive; v1.1 re-engagement value > the abstract benefit of an in-flight refactor; rename is mechanical when Phase 3 ships later | — Pending (decided 2026-05-07) |
| Channel discipline: email for slow-decision actions (payment, booking), SMS for fast actions (upload) — no doubling up | Visitor receiving SMS + email + SMS in 24h for the same action is pestering, expensive, and erodes trust on a regulated channel | — Pending |
| Daily 9am AEST firm digest replaces per-event firm alerts for abandonment | A small firm + 5 emails per session = noise → tuned out → system fails. One digest preserves signal. | — Pending |
| Smokeball stays paid-leads-only; abandonment never auto-pushes | Polluting the firm's matter list with non-paying inquiries undermines the CRM's signal-to-noise; digest is the right channel | — Pending |
| Two-key idempotency on every reminder (cancel-lookup + delivery NX) | v1.0 SCHED-05 learned this the hard way: cancel races with delivery, single-key dedup loses the messageId. Pattern is proven. | — Pending |
| One-click courtesy unsubscribe (HMAC-signed) on every reminder | Re-engagement sits in the grey zone of Spam Act commercial-vs-transactional. Defensive + reputationally protective. | — Pending |
| No business-hour deferral for sends | Calendly enforces slot validity on its end; visitor reads when they read. Fewer moving parts. | — Pending |
| Hybrid 1h email (gentle nudge + LSS explainer) instead of separate nudge + educational | One touchpoint, higher information density, no risk of an "educational" email reading like a follow-up sales pitch | — Pending |
| Continue v1.0's coarse 3-phase mergeable-boundary phasing for v1.1 | New files first (framework + payment-abandonment), then new files (appointment-abandonment), then mostly-new + small wires (digest + audit) — same pattern that worked for v1.0 | — Pending |
| Hand-edit `.planning/*.md` and use plain `git commit` | `gsd-sdk` not installed in this repo; workflow's atomic state commands unavailable | — Done in this milestone-init |

---
*Last updated: 2026-05-07 — v1.1 milestone initialised. v1.0 Phase 3 deferred; archive at `.planning/milestones/v1.0/`.*
