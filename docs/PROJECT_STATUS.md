# Aquarius Lawyers Chatbot — Project Status & Client Info

**Last updated:** 2026-04-21
**Status:** Awaiting final prerequisites before kickoff

---

## Client Contact

**Primary Point of Contact:**
- **Name:** Julie Bargenquast
- **Email:** marketing@aquariuslawyers.com.au
- **Phone:** 02 8858 3233

**Also involved:**
- Katherine — providing Calendly scheduling link

**General firm email:** info@aquariuslawyers.com.au (for notifications/transcripts)

---

## Confirmed Client Requirements (Beyond Original Proposal)

Two changes requested on 2026-04-13, plus one invoicing clarification:

### 1. Urgent SMS Notification
- SMS to solicitor (+61 450 533 474) when URGENT matter is submitted
- SMS confirmation to visitor
- On-screen message: *"A SMS has been sent to your solicitor — they will be in touch shortly."*
- **Status:** Design captured, complimentary in build (~5-8 hrs)
- **Ongoing cost:** ~$0.05-0.08 per SMS (client's cost)

### 2. BPoint Replacing Stripe
- Full replacement of Stripe with BPoint (Commonwealth Bank's gateway)
- **In-Page JavaScript embed** — inline in chat, no redirect (matches original Stripe UX)
- Faster settlement (next business day) vs Stripe (2-3 days)
- **Status:** Design captured, minor extra effort (~4-7 hrs over Stripe) absorbed

### 3. Invoice to Both Client & Firm
- **Resolution:** Smokeball handles invoicing natively. We ensure Zapier webhook payload has the data Smokeball needs. No additional development.

---

## BPoint Credentials (Production)

> 🔒 **Security note:** These must live in environment variables (`.env.local`, Vercel env config). Never commit to git.

- **Merchant name:** AQUARIUS CONSULTING GROUP PTY LTD
- **Merchant ID:** 5353109297032146
- **Password:** [Provided separately — store in secure env var, NOT in this doc]
- **Settlement Bank Account:** Aquarius Law General Account
  - BSB: 062703
  - Account number: 10226910

**Note on settlement destination:** Client has elected to settle BPoint payments into the General Account (not trust directly). Their stated rationale is faster settlement "to assist with necessary Trust Accounting" — presumably they handle the general-to-trust transfer per their internal workflow. Implementation is per client instructions.

---

## Prerequisite Status

### ✅ Confirmed / Received

- [x] **Point of contact** — Julie Bargenquast (marketing@aquariuslawyers.com.au, 02 8858 3233)
- [x] **BPoint merchant credentials** — Merchant ID + password received
- [x] **Settlement bank account** — 10226910 (General Account, BSB 062703) confirmed
- [x] **Solicitor SMS number** — +61 450 533 474 confirmed
- [x] **Firm email destination** — info@aquariuslawyers.com.au confirmed
- [x] **Zapier + Smokeball setup session** — Tuesday 2PM agreed (specific date TBC)
- [x] **Resend API key** — Not needed from client; we provision

### ⏳ Still Outstanding

- [ ] **Specific Tuesday date** for Zapier + Smokeball session
- [ ] **Calendly scheduling link** — coming from Katherine
- [ ] **SMS wording approval** — for both solicitor and visitor messages
- [ ] **BPoint sandbox/UAT credentials** — needed separately from production for development/testing (contact CBA)
- [ ] **DNS management contact** — needed to set up SPF/DKIM records for Resend email deliverability on aquariuslawyers.com.au

---

## Recap: What's Being Built

### Flow (Urgent Path)
1. Visitor arrives at chatbot → Q&A → collects details → selects URGENT
2. BPoint payment ($1,320 inc. GST) — embedded inline in chat
3. Payment confirmed → SMS to solicitor + SMS to visitor
4. Document upload
5. On-screen: "SMS has been sent to your solicitor"
6. Email transcript + Zapier → Smokeball (Smokeball generates invoice to both parties)

### Flow (Non-Urgent Path)
1. Same intake, selects NON-URGENT
2. BPoint payment ($726 inc. GST) — embedded inline
3. Payment confirmed
4. Document upload
5. Calendly booking widget embedded
6. Email transcript + Zapier → Smokeball (Smokeball generates invoice)

---

## Technical Stack Summary

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 13+ (App Router, TypeScript) |
| Chat SDK | Vercel AI SDK v4 + Google Gemini 2.5 Flash |
| Payments | **BPoint In-Page (Iframe Fields)** — replacing Stripe |
| SMS | TBD (Twilio / MessageMedia / BurstSMS — choose at implementation) |
| Booking | Calendly (embedded widget) |
| Email | Resend |
| CRM | Smokeball (via Zapier) |
| Session Store | Vercel KV |
| Hosting | Vercel Pro |

---

## Key Documents

- **Proposal:** `Aquarius Lawyers_Chatbot_Proposal_ Phase 1 and Phase 2.md`
- **Phase 1 Plan:** `docs/plans/2026-04-10-feat-criminal-law-chatbot-phase1-plan.md`
- **Scaffold Brainstorm:** `docs/brainstorms/2026-04-10-phase1-scaffold-brainstorm.md`
- **SMS + BPoint Brainstorm:** `docs/brainstorms/2026-04-13-urgent-sms-bpoint-payment-brainstorm.md`
- **This status doc:** `docs/PROJECT_STATUS.md`

---

## Next Steps

1. Chase outstanding items above (Calendly link, SMS wording, UAT credentials, DNS contact, Tuesday date)
2. Once advance received → official kickoff
3. Run `/workflows:plan` to update Phase 1 plan with BPoint + SMS changes
4. Begin implementation
