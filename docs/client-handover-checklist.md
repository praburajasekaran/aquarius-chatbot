# Aquarius Lawyers — Client Handover Checklist

_Last updated: 2026-04-16_

Tracks what the firm has provided vs what's still needed, split by internal milestone.

---

## Milestone split (internal)

- **M1 — Staging demo.** Working chatbot on a staging server with Q&A, payment flow, document upload, and email transcript wired up. Integrations can be stubbed/sandboxed.
- **M2 — Production integrations.** Zapier → Smokeball, firm's Calendly, and live payment configuration.

---

## Received

- [x] **Q&A knowledge base** — `docs/q-and-a/criminal-law.docx` (received) + ingested into `src/lib/knowledge-base/criminal-law.json` 2026-04-16. 66 Q&As across 12 categories (General, Traffic, DUID, Assault, AVOs, Drug, Theft/Fraud/Property, Fishing Licence, Boating, Court/Bail, Records, Police Powers). Wording preserved verbatim; placeholder pricing Q&A dropped (cost disclosure flows through the payment UI per LPUL).
- [x] **WordPress admin access** — confirmed
- [x] **Sample Smokeball invoice** — `docs/Invoice-193 (1) (1).pdf`. Provided by the firm as a **line-item reference** — the chatbot-initiated BPoint payment must carry one of the two prescribed descriptions below so Smokeball can reconcile it. Useful reference points extracted:
  - **ABN:** 93 784 886 927
  - **Matter reference format:** `0079 - Smith, Lyn - Proposed Sale` (4-digit matter ID + client name + matter description) — Zapier payload to Smokeball should produce matters that slot into this scheme
  - **Line-item structure:** Date, Subject, Amount (ex-GST), GST, Total — with Subtotal / GST / Total / Payments / Balance Due footer
  - **Branding on invoice:** "Aquarius Lawyers" wordmark + wave logo (for reference; no action needed — Smokeball owns this template)
- [x] **Prescribed BPoint / invoice line items** (firm's exact wording — do not paraphrase):
  - **Non-urgent path:** `Legal Strategy Session` — $660 + GST ($726 inc. GST)
  - **Urgent path:** `Initial Deposit for Urgent Court Matter` — $1,200 + GST ($1,320 inc. GST)
  - Amounts match Proposal §2. These strings must appear as the BPoint payment description and flow through as the Smokeball invoice line-item subject.
- [x] **BPoint account** — Aquarius Consulting Group Pty Ltd; ID + password stored in **macOS Keychain** under service name `aquarius-bpoint`
  - Retrieve ID: `security find-generic-password -s aquarius-bpoint | grep acct`
  - Retrieve password: `security find-generic-password -s aquarius-bpoint -w`
  - Or open **Keychain Access.app** and search "Aquarius BPoint"
- [x] **CBA General Account** — Aquarius Law general account (Commonwealth Bank); **BPoint settlement destination** (where BPoint deposits funds). BSB + account number stored in **macOS Keychain** under service name `aquarius-cba-general`
  - Retrieve: `security find-generic-password -s aquarius-cba-general -w`
  - Or open **Keychain Access.app** and search "Aquarius Law — CBA"

---

## Outstanding — blocking M1 (staging demo)

### Chat copy
Already drafted in code — firm review deferred to post-demo walkthrough (see "Firm review after demo" below). The demo gives them concrete wording to react to, which is faster than specifying from scratch.

### Payment
- [ ] **Sample BPoint receipt** — screenshot or PDF of what the firm/client actually receives after payment, so we can match the format in the confirmation screen and email transcript
- [ ] **Scope confirmation: Stripe → BPoint.** Proposal and current code use Stripe. Firm is on BPoint. Confirm switch in writing before we rebuild the payment layer. Invoicing stays in Smokeball as it works today (per client direction).

### Code fix triggered by firm's line-item spec
- [x] **Done 2026-04-16.** Split `PRICING.label` into `tier` + `lineItem` in `src/lib/stripe.ts`. Urgent now uses **"Initial Deposit for Urgent Court Matter"**, non-urgent uses **"Legal Strategy Session"**. Updated `payment-card.tsx`, `select-urgency.ts` (incl. cost-disclosure copy now branches on urgency), `initiate-payment.ts` description, and the client inquiry email subject in `resend.ts`. Generic pre-urgency CTAs (welcome message, system prompt, disclaimer banner) deliberately left as "Legal Strategy Session" — visitor doesn't know their tier yet at that point.

### Contact
- [ ] Single point of contact designated at the firm (name + email + phone)

---

## Firm review after demo (not blocking M1)

Walk the firm through the staging demo and redline as needed. Items to confirm:

- [ ] Disclaimer copy (`src/components/chat/disclaimer-banner.tsx`)
- [ ] Cost-disclosure / LPUL wording (`src/lib/tools/select-urgency.ts`, `src/components/payment/payment-card.tsx`)
- [ ] Welcome message, fallback message, urgency-question wording, thank-you/confirmation text — locations to be audited against code before demo
- [ ] Business hours definition (urgent-path "call during office hours" prompt)
- [ ] Brand tone — demo will reveal whether current copy matches firm voice
- [ ] Accepted document types per urgency tier (Proposal §5.3) — verify matches `src/lib/allowed-types.ts`

---

## Outstanding — blocking M2 (production integrations)

- [ ] **Zapier account** access / auth session (~10 min guided)
- [ ] **Smokeball** access via Zapier (Lead, Contact, Matter creation + doc attachment)
- [ ] **Calendly** — firm's configured scheduling link for non-urgent bookings
- [ ] **Resend** API key (for firm notification emails + transcripts)
- [ ] Confirm destination inbox — proposal references `info@aquariuslawyers.com.au`

---

## Open scope questions to raise with the firm

1. **Stripe → BPoint swap.** Signed scope change needed; affects payment UI, receipt handling, and confirmation email. No impact on Smokeball invoicing.
2. **BPoint integration method.** Hosted redirect vs embedded? Does BPoint return a webhook / receipt payload we can capture, or does the client need to manually forward the emailed receipt? This determines whether we can auto-attach payment confirmation to the Smokeball matter.
3. **Bank account reconciliation.** Sample invoice #193 shows BSB 062-703, Account **10275405** as the payment-instruction account — but the CBA General Account we were given is **10226910** (same BSB). Two possibilities:
   - 10275405 is the **trust account** (client funds, per Legal Profession Uniform Law) and 10226910 is the general operating account where BPoint settles → normal setup, nothing to fix.
   - One of them is out of date.
   - Ask the firm which account is the live BPoint settlement destination and whether there's also a trust account we should be aware of.
4. **Ongoing maintenance plan** — single practice area ($400/mo) vs all five ($600/mo), to be decided before go-live.
