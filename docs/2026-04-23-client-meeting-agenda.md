# Client Meeting — 2026-04-23 (30 min)

**With:** Julie Bargenquast (Aquarius Lawyers)
**Goal:** Gather credentials for Monday's demo.
**Design reference:** `docs/superpowers/specs/2026-04-22-urgent-sms-and-bpoint-payment-design.md`
**Post-meeting status:** `docs/2026-04-23-integration-status.md`

---

## Agenda (30 min)

| Time | Item |
|---|---|
| 00–03 | 3 quick decisions (below) |
| 03–08 | Zapier + Smokeball |
| 08–12 | Resend |
| 12–15 | ClickSend |
| 15–18 | Calendly |
| 18–24 | **BPoint** — biggest schedule risk |
| 24–26 | Vercel + Upstash (production only) |
| 26–30 | Recap + action items |

---

## 3 Decisions (30 sec each — verbal ✅)

1. SMS recipient = `+61 450 533 474`. One number, not a roster.
2. SMS to solicitor reads: *"URGENT — Aquarius chatbot intake. Client: [name] ([phone], [email]). Session [id]."*
3. Client gets confirmation email only (no SMS to client).

---

## The 6 Services — What Julie Does On The Call

For each service: **create account → invite me → confirm plan tier.** I'll do the rest async.

### 1. Zapier + Smokeball

- [ ] Zapier on **Professional plan** (~$86.52/mo — webhooks need it)
- [ ] Invite me as **Member**
- [ ] Inside Zapier, click "Connect Smokeball" → Julie enters her Smokeball login (stored inside Zapier — I never see it)
- [ ] Quick sanity check: create a throwaway Smokeball test Zap, run once, delete

*After the call: I build the 3 real Zaps, map fields, test.*

### 2. Resend (email)

- [ ] Create Resend account → add domain `aquariuslawyers.com.au`
- [ ] Publish SPF + DKIM records Resend provides (we have DNS access — fast)
- [ ] Invite me as team member
- [ ] Confirm sender + notify addresses (e.g. `chatbot@aquariuslawyers.com.au` / `reception@aquariuslawyers.com.au`)

### 3. ClickSend (SMS)

- [ ] Create ClickSend account → fund ~AUD $20
- [ ] Submit alpha sender ID `AQUARIUS` (approval: 1–2 business days)
- [ ] Invite me as sub-user

*Monday fallback: numeric sender if alpha not yet approved.*

### 4. Calendly (booking)

Already integrated in code — webhook handler exists but no signing key set. Without webhook, we can't trigger the post-booking email/Smokeball flow.

- [ ] Confirm Calendly on **Standard plan or higher** ($12/user/mo — webhooks need paid tier)
- [ ] Invite me as a team member
- [ ] In Calendly → Integrations → Webhooks: create subscription pointing to `https://[demo-url]/api/webhooks/calendly`, event = `invitee.created`
- [ ] Copy the **signing key** Calendly displays at creation (shown once — capture it on the call)

*Monday fallback: demo booking embed without webhook (booking still works, just no auto-email/CRM).*

### 5. BPoint ⚠️ (highest risk)

**Confirm first:** Does Aquarius's CBA merchant facility have **BPoint API + Iframe Fields** enabled? (Not BPoint Lite — Lite is hosted-only.)

- If yes → proceed to credential setup below.
- If no → CBA upgrade = 1–2 weeks. Monday demo shows BPoint as UI mockup.

- [ ] Log into BPoint Back Office
- [ ] Create UAT API user (`aquarius-chatbot-uat`)
- [ ] Add me as operator
- [ ] (Prod API user can come later, pre-launch)

### 6. Vercel + Upstash (production only — not needed for Monday)

- [ ] Create Vercel account → upgrade to **Pro** ($20/user/mo) → invite me as Developer
- [ ] Create Upstash account (free tier, region `ap-southeast-2`) → invite me

*After the call: I migrate the project to Aquarius's infrastructure before go-live.*

> **2026-04-23 post-call update:** Aquarius Vercel account deferred — Monday demo runs
> on the agency's Vercel (`aquarius-chatbot.vercel.app`). Migration to Aquarius's Vercel
> + Upstash org is a pre-launch task, not a demo blocker. Revisit after Monday.

---

## Credentials Julie Shares After The Call (securely)

Use 1Password share, Bitwarden Send, or similar — **not email/Slack plaintext**.

- Resend: API key, sender address, notify address
- ClickSend: username, API key, sender ID
- Calendly: webhook signing key
- BPoint UAT: API username, password, merchant number, biller code
- Upstash: Redis URL + token
- Zapier webhook URLs: **I generate these myself** once I'm a Member

---

## What I Handle Async (Julie doesn't worry about these)

- Build the 3 Zaps + Smokeball field mapping
- Write SMS + BPoint code
- Migrate project to Aquarius's Vercel
- Prepare Monday demo (with fallbacks for anything not ready)

---

## One Follow-up Ask (async, 5 min Slack/email)

Which Smokeball fields should receive:
- Urgency tag?
- BPoint receipt number (for Trust Accounting reconciliation)?
- Matter description?

I'll proceed with sensible defaults if no reply by Thursday.

---

## Post-Meeting Outcomes (2026-04-23 evening)

Credentials captured, Zapier + Smokeball integration built, capture-back
architecture designed. Full status in
[`docs/2026-04-23-integration-status.md`](./2026-04-23-integration-status.md).

### What landed ✅

| Service | Status | Notes |
|---|---|---|
| Resend | API key + from/notify emails saved | Domain verified earlier |
| ClickSend | Username + API key saved | Sender ID pending ClickSend alpha-tag approval (`AquariusLaw`, ~1-2 days) |
| Calendly | PAT + webhook subscription live | Subscription `dca8e625-b160-4e81-9a7b-99306754b12f`, signing key saved |
| BPoint | SCI-only API user + merchant/biller codes | Prod facility only (no separate UAT), dev uses sandbox endpoint |
| Zapier #1 (intake+payment → Smokeball) | Published, end-to-end tested | `isTest` filter blocks dev payloads from Smokeball |
| Zapier #4 (dev-only email) | Published | Dev code posts here; never touches Smokeball |
| Zapier #2 (late upload) | URL captured, action design in progress | Awaiting capture-back endpoint |
| Zapier #3 (audit log) | URL captured, action TBD | Defer until post-demo |

### Deferred

- **Vercel migration** — staying on agency's Vercel (`aquarius-chatbot.vercel.app`) for Monday demo. Migrate to Aquarius org pre-launch.
- **Upstash migration** — same call: keep agency's instance for demo.
- **BPoint Iframe Fields check** — Julie to confirm with CBA Merchant Services whether Iframe Fields is enabled on facility (SCI is enabled; Iframe Fields is a separate config flag).
- **ClickSend alpha sender ID** — swap `CLICKSEND_SENDER_ID=""` → `CLICKSEND_SENDER_ID="AquariusLaw"` once approval arrives (~1-2 business days).

### Architectural decisions made during setup

1. **Dev/Prod Zap split + `isTest` filter.** Dev code POSTs to Zap #4 (email-only), prod code POSTs to Zap #1 (Smokeball). Each prod Zap has a Filter step that blocks payloads with `isTest: true`. Defence in depth against test pollution.
2. **Session → Smokeball matter mapping via capture-back.** Zap #1's tail step POSTs `{sessionId, smokeballMatterId}` back to `/api/webhooks/smokeball-matter-created`. We store it in Redis keyed by sessionId; late-upload flow reads it when posting to Zap #2.
3. **Top-level `isTest` boolean** (not nested `meta.testPayload`). Nested fields had field-picker binding issues in Zapier.

### Follow-up tasks on Julie

- Confirm BPoint Iframe Fields is enabled with CBA (async, ring them)
- Ping once ClickSend alpha sender ID is approved
- Invite to Aquarius Vercel + Upstash orgs (post-Monday)
- Smokeball field mapping for: urgency tag field, BPoint receipt number field, matter description field (will proceed with defaults if no reply by Thursday)
