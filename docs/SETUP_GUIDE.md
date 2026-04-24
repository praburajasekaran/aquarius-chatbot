# Aquarius Lawyers Chatbot — Setup Guide

Step-by-step implementation and infrastructure setup. Work through each phase in order.

**Project:** Aquarius Lawyers criminal law chatbot
**Repo:** `/Users/praburajasekaran/Library/CloudStorage/GoogleDrive-ekalaivan@gmail.com/My Drive/local-htdocs/c-projects/Aquarius Lawyers`

---

## Phase 0: Prerequisites from Client

Before writing any code, confirm these are in hand (see `PROJECT_STATUS.md`):

- [x] BPoint production credentials (Merchant ID + password)
- [x] BPoint settlement account (10226910, BSB 062703)
- [x] Solicitor SMS number (+61 450 533 474)
- [x] Firm email (info@aquariuslawyers.com.au)
- [x] Primary contact (Julie Bargenquast)
- [ ] **BPoint UAT/sandbox credentials** ← BLOCKER for dev
- [ ] **DNS manager contact** for aquariuslawyers.com.au
- [ ] **Calendly link** (from Katherine)
- [ ] **SMS wording approval**
- [ ] **Office hours** for fallback messaging
- [ ] **Logo / brand assets** (high-res)

**Do not start Phase 2 (code) until BPoint UAT creds are received.**

---

## Phase 1: Accounts & Service Setup

Create accounts and gather API keys. Put everything in a password manager as you go.

### 1.1 Vercel (Hosting + KV)

- [ ] Create Vercel account / team (if not existing)
- [ ] Upgrade to Vercel Pro ($31/mo) — required for commercial use
- [ ] Create project `aquarius-chatbot` (will link to git repo in Phase 2)
- [ ] Provision **Vercel KV** store — note connection URL and tokens
- [ ] Add team members if needed

**Env vars to capture:**
- `KV_URL`
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `KV_REST_API_READ_ONLY_TOKEN`

---

### 1.2 Google Gemini API (LLM for intent matching)

- [ ] Go to [Google AI Studio](https://aistudio.google.com/apikey)
- [ ] Create API key (select Gemini 2.5 Flash)
- [ ] Set up billing if needed
- [ ] Add usage limits to prevent runaway costs

**Env var:**
- `GOOGLE_GENERATIVE_AI_API_KEY`

---

### 1.3 BPoint (Payment Gateway)

- [ ] **Production credentials** — already received:
  - Merchant ID: `5353109297032146`
  - Password: [stored in password manager]
- [ ] **Request UAT/sandbox credentials** from CBA (Julie to initiate via her CBA relationship manager)
  - UAT URL: `https://www.bpoint.uat.linkly.com.au`
- [ ] Whitelist BPoint webhook source IPs in any firewall/middleware:
  - `203.195.127.4`
  - `202.166.187.3`
- [ ] Test UAT dashboard access

**Env vars:**
- `BPOINT_MERCHANT_ID`
- `BPOINT_USERNAME` (typically `webforms`)
- `BPOINT_PASSWORD`
- `BPOINT_API_URL` (UAT: `https://www.bpoint.uat.linkly.com.au`, Prod: `https://www.bpoint.com.au`)
- `BPOINT_WEBHOOK_SECRET` (if applicable)

---

### 1.4 SMS Provider

**Recommended for this project: Twilio** (best docs, simplest integration, Vercel-friendly)

- [ ] Create Twilio account
- [ ] Purchase an Australian sender number or register a Sender ID (requires AU business ABN)
- [ ] Verify the solicitor's mobile (+61 450 533 474) in test mode
- [ ] Add funds (minimum $20 to start)

**Env vars:**
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER` (or sender ID string)
- `SOLICITOR_SMS_NUMBER=+61450533474`

**Alternative providers** (if client prefers AU-owned):
- MessageMedia — https://developers.messagemedia.com
- BurstSMS (Transmit) — https://developer.transmitsms.com

---

### 1.5 Resend (Email)

- [ ] Create Resend account at [resend.com](https://resend.com)
- [ ] Add domain: `aquariuslawyers.com.au`
- [ ] Get DNS records to add (SPF, DKIM, DMARC)
- [ ] Send DNS records to Julie / DNS manager for configuration
- [ ] Verify domain once DNS propagates
- [ ] Create API key

**Env vars:**
- `RESEND_API_KEY`
- `EMAIL_FROM=noreply@aquariuslawyers.com.au`
- `EMAIL_TO_FIRM=info@aquariuslawyers.com.au`

---

### 1.6 Calendly

- [ ] Client's Calendly account exists (Katherine providing link)
- [ ] Confirm event type link
- [ ] Optional: Calendly API key if deep integration needed (for webhooks)

**Env var:**
- `CALENDLY_URL` (e.g., `https://calendly.com/aquariuslawyers/consultation`)

---

### 1.7 Zapier + Smokeball

Complete during the **Tuesday 2PM client session** (see `MEETING_AGENDA_2026-04-TUESDAY.md`):

- [ ] Julie's Zapier account on **Professional plan** ($86.52/mo)
- [ ] Create Zap: **Webhooks by Zapier (Catch Hook)** → **Smokeball (Create Matter)**
- [ ] Note the webhook URL from Zapier
- [ ] Authorize Smokeball within Zapier
- [ ] Map fields: name, email, phone, matter type, urgency, payment ref, documents
- [ ] Test with sample payload
- [ ] Turn Zap ON

**Env var:**
- `ZAPIER_WEBHOOK_URL`

---

### 1.8 GitHub / Git Repository

- [ ] Create private GitHub repo: `aquarius-chatbot`
- [ ] Add collaborators (developer + Julie if she wants access)
- [ ] Set default branch protection on `main`
- [ ] Add `.gitignore` (Next.js defaults + `.env*`)

---

## Phase 2: Local Development Environment

### 2.1 Project Initialization

```bash
cd "/Users/praburajasekaran/Library/CloudStorage/GoogleDrive-ekalaivan@gmail.com/My Drive/local-htdocs/c-projects/Aquarius Lawyers"

# Create new git branch (per user's global rule)
git checkout -b feat/chatbot-phase1-scaffold

# Initialize Next.js
npx create-next-app@latest aquarius-chatbot --typescript --tailwind --app --src-dir

cd aquarius-chatbot

# Install dependencies
npm install ai @ai-sdk/google @vercel/kv resend twilio lucide-react
npm install -D @types/node
```

### 2.2 Environment Variables

Create `.env.local` (never commit this file):

```bash
# Vercel KV
KV_URL=...
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
KV_REST_API_READ_ONLY_TOKEN=...

# Google Gemini
GOOGLE_GENERATIVE_AI_API_KEY=...

# BPoint (UAT for dev)
BPOINT_MERCHANT_ID=5353109297032146
BPOINT_USERNAME=webforms
BPOINT_PASSWORD=...
BPOINT_API_URL=https://www.bpoint.uat.linkly.com.au

# SMS (Twilio)
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=...
SOLICITOR_SMS_NUMBER=+61450533474

# Email (Resend)
RESEND_API_KEY=...
EMAIL_FROM=noreply@aquariuslawyers.com.au
EMAIL_TO_FIRM=info@aquariuslawyers.com.au

# Calendly
CALENDLY_URL=https://calendly.com/aquariuslawyers/...

# Zapier
ZAPIER_WEBHOOK_URL=https://hooks.zapier.com/hooks/catch/...

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 2.3 Verify Setup

```bash
npm run dev
# Visit http://localhost:3000 — confirm Next.js runs
```

---

## Phase 3: Build Order

Follow the plan at `docs/plans/2026-04-10-feat-criminal-law-chatbot-phase1-plan.md`, with these updates for BPoint + SMS:

### Updated Build Sequence

1. **A: Scaffold + KV session store**
2. **B: Chat UI + AI SDK integration** (Gemini tool calling)
3. **C: Knowledge base + intent matching**
4. **D: Detail collection tool** (name, email, phone validation)
5. **E: Urgency selection tool**
6. **F: Payment — BPoint In-Page Iframe Fields** ⭐ *(was Stripe)*
   - Server: `POST /api/checkout` creates BPoint AuthKey
   - Client: `components/payment/bpoint-payment.tsx` renders iframe fields
   - Server: `POST /api/webhooks/bpoint` handles callback + deduplicates by `txnNumber`
7. **G: Document upload tool**
8. **H: Urgent SMS notification** ⭐ *(NEW)*
   - Server: `lib/sms.ts` — Twilio client wrapper
   - On payment success for urgent matters: send solicitor SMS + visitor SMS
   - Update UI message: "SMS has been sent to your solicitor"
9. **I: Calendly embed** (non-urgent only)
10. **J: Final submission — Resend email + Zapier webhook**
11. **K: WordPress embed script**
12. **L: End-to-end testing**

---

## Phase 4: Testing Strategy

### 4.1 BPoint Test Cards (UAT)

Get official test card numbers from BPoint UAT docs. Typical test cards include:
- Successful: `4564710000000004`
- Declined: `4564710000000012`
- (Confirm actual values in UAT environment)

### 4.2 SMS Testing

- Test to developer's own mobile first
- Test to solicitor number only with explicit approval
- Twilio trial account can only send to verified numbers — verify solicitor number in dev

### 4.3 End-to-End Test Journeys

- [ ] Urgent happy path: intake → payment → upload → SMS fires → email sent → Smokeball record created → invoice generated
- [ ] Non-urgent happy path: intake → payment → upload → Calendly booking → email → Smokeball
- [ ] Payment failure: card declined, retry works
- [ ] SMS failure: Twilio error handled, email fallback triggered
- [ ] Session expiry: 1-hour TTL enforced
- [ ] Browser close mid-flow: webhook still fires, firm notified
- [ ] Mobile responsive: all flows work on iPhone + Android
- [ ] Voice input (Web Speech API) works in Chrome/Safari

---

## Phase 5: Deployment

### 5.1 Staging (Vercel Preview)

- [ ] Connect GitHub repo to Vercel
- [ ] Configure all env vars in Vercel dashboard (use UAT BPoint creds)
- [ ] Preview URL works end-to-end
- [ ] Share preview URL with Julie for UAT

### 5.2 UAT with Client

- [ ] Julie runs through all test journeys
- [ ] Collect feedback
- [ ] Fix issues
- [ ] Sign-off

### 5.3 Production

- [ ] Swap env vars to production BPoint creds
- [ ] Update `BPOINT_API_URL` to production: `https://www.bpoint.com.au`
- [ ] Verify DNS/email deliverability (send a real test email)
- [ ] Verify Zapier Zap is ON and pointing to production webhook URL
- [ ] Deploy to production
- [ ] Smoke test with a $0.01 test transaction (if possible) or use BPoint's test mode on production URL

### 5.4 WordPress Embed

- [ ] Provide embed script tag to Julie / her web dev:
  ```html
  <script src="https://aquarius-chatbot.vercel.app/embed.js" defer></script>
  ```
- [ ] Confirm widget loads on criminal law page
- [ ] Confirm no style conflicts with WordPress theme

---

## Phase 6: Post-Launch

- [ ] Monitor Vercel logs for errors (first 48 hours)
- [ ] Monitor Zapier task history for failed Zaps
- [ ] Monitor Twilio delivery reports
- [ ] Monitor BPoint transaction dashboard
- [ ] Weekly check-in with Julie for first month
- [ ] Hand over admin docs (see `docs/HANDOVER.md` — TBC)

---

## Security Checklist

- [ ] No credentials committed to git (check `.gitignore` covers all `.env*` files)
- [ ] BPoint password stored only in Vercel env vars + password manager
- [ ] All API routes validate inputs (Zod schemas recommended)
- [ ] Rate limiting on public endpoints (Vercel Edge or Upstash ratelimit)
- [ ] CORS configured correctly for WordPress origin
- [ ] CSP headers set
- [ ] Webhook signature verification where supported (BPoint, Stripe-style HMAC)
- [ ] Session TTL (1 hour) enforced in KV
- [ ] No PII logged to console/logs
- [ ] PCI scope minimized (BPoint iframes handle card data)

---

## Quick Reference: Who Does What

| Task | Owner |
|------|-------|
| BPoint UAT credentials request | Julie → CBA |
| DNS records for Resend | Julie → DNS provider |
| Calendly link | Katherine |
| SMS wording approval | Julie |
| Zapier account + upgrade | Julie (in Tuesday session) |
| Everything else | Developer |

---

## Related Docs

- `docs/PROJECT_STATUS.md` — current state + client info
- `docs/MEETING_AGENDA_2026-04-TUESDAY.md` — client meeting agenda
- `docs/brainstorms/2026-04-13-urgent-sms-bpoint-payment-brainstorm.md` — SMS + BPoint design
- `docs/brainstorms/2026-04-10-phase1-scaffold-brainstorm.md` — original scaffold design
- `docs/plans/2026-04-10-feat-criminal-law-chatbot-phase1-plan.md` — full Phase 1 technical plan
- `Aquarius Lawyers_Chatbot_Proposal_ Phase 1 and Phase 2.md` — original proposal
