# Aquarius Lawyers Chatbot — ClickSend SMS Integration

## What This Is

A milestone on the existing Aquarius Lawyers chatbot (Next.js App Router app that chats with prospective clients, matches questions against a curated criminal-law Q&A base, captures intake details, takes payment, and pushes files into the firm's Smokeball matter via Zapier). This milestone adds **ClickSend SMS nudges to the post-payment document-upload flow** so clients actually see the upload link and the firm isn't blocked waiting on email.

## Core Value

Paying clients reliably get their documents to the firm — because their mobile buzzed, not because they happened to check an email.

## Requirements

### Validated

<!-- Capabilities the existing codebase already provides and this milestone builds on top of. -->

- ✓ Chatbot conversation with intake capture (name, email, AU-validated phone, matter category, urgency) — `src/lib/tools/collect-details.ts`, `src/lib/validators.ts`
- ✓ Static criminal-law Q&A knowledge base with LLM matcher — `src/lib/knowledge-base/criminal-law.json`, `src/lib/tools/match-question.ts`
- ✓ Stripe-based payment + upload-token issuance on success — `src/app/api/webhooks/stripe/route.ts`, `src/lib/upload-tokens.ts`
- ✓ Post-payment transactional email to client with upload link, and new-lead alert to firm — `src/lib/resend.ts`, `src/lib/email/*`
- ✓ Late-upload endpoint that validates token, accepts files, pushes them to Smokeball via Zapier — `src/app/api/late-upload/session/route.ts`, `src/lib/late-upload/handle-completed.ts`
- ✓ Session + intake + upload-token storage in Upstash Redis — `src/lib/kv.ts`, `src/lib/intake.ts`, `src/lib/upload-tokens.ts`

### Active

<!-- Hypotheses for this milestone. Validated when shipped and we can see upload completion rates lift. -->

- [ ] Client receives an SMS immediately on payment success containing the upload link
- [ ] Client receives a follow-up SMS 24 hours later **only if they haven't uploaded yet**
- [ ] SMS dispatch fires the same way whether the payment came through Stripe or through Bpoint (the in-progress replacement in a parallel worktree)
- [ ] Landline phone numbers are detected and silently skipped (logged, not errored)
- [ ] Phone numbers are normalised to E.164 (+61…) before hitting ClickSend
- [ ] SMS copy includes Spam Act–compliant opt-out language and is dispatched from a registered AU sender ID
- [ ] ClickSend credentials live in env (not code) and are absent-safe (app boots without them; SMS just logs a warning)

### Out of Scope

- **Two-way SMS / inbound replies** — STOP handling will be delegated to ClickSend's built-in opt-out list; we won't build a reply inbox. — *Scope containment for a ~1-day feature.*
- **Booking reminders (Calendly → SMS)** — Different trigger, different copy, different consent story. — *Defer; decide separately after upload-nudge proves out.*
- **Firm new-lead SMS alert** — Firm already gets email; this milestone is client-facing only. — *Avoid scope creep.*
- **Migrating Stripe → Bpoint** — That's happening in the `clicksend-sms`-adjacent worktree. This milestone *depends on* a provider-agnostic trigger but does not do the migration. — *Separation of concerns.*
- **Rebuilding the fragmented Redis session model** — Flagged in `.planning/codebase/CONCERNS.md` but out of scope for this feature. — *Known debt; not this milestone.*
- **Adding tests to previously untested areas of the codebase** — New SMS code should be tested; retroactive coverage of existing code is a separate initiative. — *Scope containment.*

## Context

- **Brownfield**. Codebase mapped on 2026-04-24; artefacts in `.planning/codebase/`. Key reads: `ARCHITECTURE.md`, `INTEGRATIONS.md`, `CONCERNS.md`.
- **Parallel work**: A separate worktree is migrating the payment provider from Stripe to Bpoint. SMS dispatch must not hook Stripe-specific types or webhook bodies; it should fire off an internal event that both providers can emit.
- **Geography**: Aquarius Lawyers is an Australian firm; all clients are AU. The existing phone validator (`validatePhone` at `src/lib/validators.ts:11`) already accepts AU mobile and landline formats but does not produce E.164.
- **Regulatory**: AU Spam Act 2003 — commercial SMS requires consent (implied by the client initiating the intake and paying), clear sender identification, and a functional unsubscribe. ClickSend handles the STOP keyword natively.
- **Deliverability cost**: ClickSend is per-segment, per-message; 24h-reminder must respect the "already uploaded" check to avoid wasted sends and client annoyance.
- **Observability gap**: Logging in existing webhook handlers is inconsistent (see CONCERNS.md). SMS dispatch should log structured events so we can measure delivery and upload-completion lift.

## Constraints

- **Tech stack**: Next.js App Router + TypeScript + Vercel. No new runtime; ClickSend integration is a TypeScript module using their HTTPS REST API. — *Consistency with existing integration pattern (`src/lib/resend.ts`, Zapier webhooks).*
- **Dependencies**: No heavyweight SMS SDK — the ClickSend REST surface is small; use `fetch`. — *Avoid bundle bloat and the "unmaintained SDK" risk.*
- **Payment-provider-agnostic**: SMS trigger must be decoupled from Stripe and Bpoint webhook handlers via an internal event/function call abstraction. — *Bpoint migration happening in parallel; avoid merge conflicts and duplicated logic.*
- **Timeline**: Roughly 1 day of focused work. Drives coarse-grained phasing and lean tests. — *Stated by user.*
- **Security**: ClickSend API key in `process.env` only; never log the key; never embed the upload token in anything other than an HTTPS URL; rate-limit outbound SMS per session to prevent abuse. — *Existing patterns in the codebase already follow these rules.*
- **Compatibility**: App must continue to boot and function if `CLICKSEND_*` env vars are missing (e.g. local dev, PR previews) — SMS dispatch degrades to a warning log. — *Developer ergonomics + preview environments.*

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Trigger SMS off an internal `intake-paid` event, not directly from Stripe/Bpoint webhook handlers | Bpoint migration is in flight in a parallel worktree; coupling to Stripe-specific code now would guarantee merge conflicts and duplicated dispatch logic | — Pending |
| Single reminder at 24h if no upload; no escalating ladder | User directive. Keeps scope tight and avoids the "pestering" perception on a regulated channel | — Pending |
| Silently skip landlines, log for observability, no fallback action | User directive. Client already received email; double-contact via staff phone-call isn't this feature's job | — Pending |
| Use ClickSend (not Twilio, not a generic SMS gateway) | User directive; ClickSend is AU-based, has local sender IDs, handles STOP opt-outs natively | — Pending |
| Defer the 24h scheduler mechanism (Vercel Cron vs Upstash QStash vs other) to plan-phase | Both are viable; the choice depends on reliability/cost trade-offs best explored during research, not questioning | — Pending |

---
*Last updated: 2026-04-24 after initialization*
