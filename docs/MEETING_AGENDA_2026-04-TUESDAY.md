# Client Meeting Agenda — Zapier + Smokeball Setup + Kickoff

**With:** Julie Bargenquast (Aquarius Lawyers)
**Date:** Tuesday [TBC] @ 2:00 PM
**Duration:** ~45-60 minutes
**Format:** Google Meet / Zoom (share screen both ways)

---

## Before the Meeting — Prep Checklist

- [ ] Julie logged into Zapier (or ready to create account) at meeting start
- [ ] Julie has Smokeball admin credentials ready
- [ ] We have test BPoint credentials loaded (if available)
- [ ] Share screen permissions confirmed on both sides
- [ ] Have this agenda visible/shared

---

## Agenda

### 1. Quick Recon (5 min)
- Quick confirmation of scope: SMS notifications + BPoint + Smokeball-generated invoices
- Confirm any new items or changes since last communication
- Any questions from Julie's team before we dive in

### 2. Zapier Setup (15 min) — *Primary purpose*
- Walk Julie through connecting her Zapier account
- Create the Zap: **Webhook → Smokeball**
- Configure the webhook endpoint we'll POST to
- Test the connection with a sample payload
- Confirm Zapier plan is Professional tier ($86.52/mo) — required for webhooks + multi-step Zaps

### 3. Smokeball Integration (15 min)
- Authorize Smokeball connection within Zapier
- Map webhook fields → Smokeball:
  - Lead / contact creation
  - Matter creation (with urgency tag)
  - Document attachment
  - Payment reference for invoice generation
- Test end-to-end: fire a test webhook → verify record appears in Smokeball
- Confirm invoicing flow — Julie demonstrates how Smokeball will generate the invoice from the data we send

### 4. DNS / Email Setup (5 min)
- Who manages DNS for aquariuslawyers.com.au? (Crazy Domains / GoDaddy / Cloudflare / IT provider?)
- We'll send SPF + DKIM records for Resend email deliverability
- Confirm sender email: `info@aquariuslawyers.com.au` or a separate `noreply@` address?

### 5. SMS Wording Approval (5 min)
Present drafts for sign-off:

**Solicitor SMS:**
> "URGENT: [Name] ([Phone]) - [Matter Type]. Payment confirmed. Aquarius Chatbot."

**Visitor SMS:**
> "Thank you [Name]. Aquarius Lawyers has received your urgent matter. A solicitor will contact you shortly. - Aquarius Lawyers"

Get approval or edits.

### 6. Remaining Prerequisites (5 min)
- **Calendly link** — status from Katherine? Can we have it by [date]?
- **BPoint UAT/sandbox credentials** — Julie to contact CBA for test environment access (we need this before we can develop/test payments)
- **Office hours** for the "call firm" fallback message (if urgent but outside hours)
- **Logo / brand assets** for chatbot styling — high-res versions

### 7. Timeline & Next Steps (5 min)
- Confirm advance payment received → dev kicks off
- Expected Phase 1 duration: [X weeks]
- Milestones: dev complete → UAT with Julie → production deploy
- Communication cadence (weekly check-in? Slack? Email?)
- Who signs off on UAT?

### 8. Q&A / Wrap (5 min)
- Open questions from Julie
- Action items recap — who owns what by when

---

## Outputs From Meeting (Checklist)

By the end we should have:

- [ ] Zapier account connected and test webhook firing
- [ ] Smokeball authorized in Zapier, test record created
- [ ] SMS wording approved (both messages)
- [ ] DNS manager contact identified
- [ ] Target date for Calendly link
- [ ] Julie to request BPoint UAT credentials from CBA
- [ ] Office hours confirmed
- [ ] Logo / brand assets provided (or target date)
- [ ] Kickoff date agreed
- [ ] UAT sign-off owner agreed

---

## Risks / Things to Watch

- **Smokeball field mapping gotchas** — Smokeball has specific required fields for matter creation; we may hit validation errors. Come prepared with their API docs open.
- **Zapier plan tier** — if Julie is on free/starter, webhooks won't work. May need to upgrade on the call.
- **DNS changes** — some IT providers take days to action DNS changes. Identify this early.
- **BPoint UAT access** — CBA can be slow to provide sandbox access. Flag this as the #1 blocker for dev start.
