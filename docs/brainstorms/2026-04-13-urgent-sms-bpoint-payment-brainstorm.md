# Brainstorm: Urgent SMS Notifications + BPoint Payment Integration

**Date:** 2026-04-13
**Status:** Ready for planning
**Triggered by:** Client requirement — two changes needed before proceeding

---

## What We're Building

Two enhancements to the criminal law chatbot flow:

### 1. Urgent Matter SMS Notification

When a visitor selects "URGENT" in the chatbot flow and completes payment:

- **Solicitor SMS** to +61 450533474 containing: client name, phone number, and matter type (e.g., "URGENT: John Smith (0412345678) - DUI/Drink Driving. Payment confirmed.")
- **Visitor SMS** confirmation to the phone number they provided during intake
- **On-screen message** to visitor: "A SMS has been sent to your solicitor - they will be in touch shortly."

This replaces the current design where urgent users are simply told to "call the firm during office hours." The new flow is more proactive — the solicitor is notified immediately and reaches out to the client.

### 2. BPoint Payment Gateway (Replacing Stripe)

Replace the planned Stripe integration entirely with BPoint (Commonwealth Bank's payment gateway).

**Why BPoint over Stripe:**
- Aquarius Lawyers banks with CBA — BPoint settles directly into their nominated account (can be the trust account)
- Settlement is next business day vs Stripe's 2-3 business days
- No intermediary pooled account — funds go directly where they need to be
- Critical for Australian legal trust accounting compliance (Legal Profession Uniform Law requires client funds deposited directly into the designated trust account, not held by third parties)
- Stripe routes through a pooled account first, creating compliance risk under trust accounting regulations

---

## Why This Approach

### SMS Notification
- The client specifically requested this — it's a business requirement, not a technical preference
- Proactive solicitor notification is better UX than telling a distressed client to "call during office hours"
- SMS is immediate and reliable for urgent legal matters
- Both parties (solicitor and client) get confirmation, reducing anxiety and missed connections

### BPoint Payment
- Direct trust account settlement is a legal compliance requirement, not just a preference
- 2-3 day Stripe delay creates cash flow and reconciliation issues
- CBA merchant facility already exists — no new banking relationship needed
- BPoint supports custom reference fields for matter/client ID mapping (important for trust account reconciliation)

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| SMS recipients | Both solicitor AND visitor | Client gets peace of mind; solicitor gets immediate alert |
| SMS content (solicitor) | Name + phone + matter type | Enough to act on without being too long for SMS |
| Payment gateway | BPoint only (replace Stripe) | Trust accounting compliance, faster settlement |
| SMS provider | Decide during implementation | Options: Twilio, MessageMedia, BurstSMS — all viable |
| BPoint integration method | **In-Page (JavaScript embed)** | Embeds inline in chat — same UX as Stripe embedded checkout, no redirect |
| SMS cost model | Complimentary build, client covers per-SMS cost | Goodwill gesture; ~$0.05-0.08/SMS is negligible at expected volume |
| BPoint extra effort | Absorbed / minimal surcharge | Delta is only 4-7 hrs over Stripe; client is paying for payment integration regardless |

---

## Impact on Existing Design

### Changes Required

1. **Payment flow**: Replace all Stripe references with BPoint **In-Page (JavaScript embed)**
   - BPoint's In-Page integration injects a secure iframe into a `<div>` — identical UX to Stripe's `ui_mode: 'embedded'`
   - Include BPoint JS library, initialize into a container div inside the chat
   - Payment completes via JavaScript callback — no redirect, user stays in chat
   - `POST /api/checkout` — create BPoint auth key instead of Stripe session
   - `POST /api/webhooks/stripe` → `POST /api/webhooks/bpoint` — BPoint webhook/callback
   - Session data: `paymentId` becomes BPoint transaction reference
   - Remove Stripe SDK dependency, add BPoint REST API calls (no official Node.js SDK — manual HTTP)

2. **Urgent flow enhancement**: After payment confirmed for urgent matters
   - New: Send SMS to solicitor via chosen SMS provider API
   - New: Send SMS confirmation to visitor
   - Change on-screen message from "call the firm" to "SMS has been sent to your solicitor"
   - New API route or server action for SMS sending

3. **New dependencies**:
   - SMS provider SDK/API (TBD)
   - BPoint API credentials (CBA merchant facility)

4. **Zapier webhook payload**: Add SMS delivery status, update payment gateway references

### What Stays the Same

- Overall 9-step flow structure
- Urgency selection mechanism ($1,320 urgent / $726 non-urgent)
- Document upload, Calendly booking (non-urgent), email transcripts
- Session management (Vercel KV)
- All other integrations (Resend, Zapier, Smokeball)

---

## Open Questions

1. ~~**BPoint integration method**~~ — **RESOLVED: In-Page (JavaScript embed)**. Embeds inline in chat, same UX as current Stripe embedded checkout. No redirect.
2. **SMS provider selection**: Twilio (best DX), MessageMedia (AU-owned), or BurstSMS (cheapest)? — Decide during implementation
3. **SMS failure handling**: What happens if SMS fails to send? Retry? Fallback to email? Show error to visitor?
4. **Visitor SMS content**: What exact wording? E.g., "Thank you [Name]. Your urgent matter has been received by Aquarius Lawyers. A solicitor will contact you shortly."
5. **BPoint credentials**: Need CBA merchant ID, API key, and encryption key — client to provide
6. **BPoint test environment**: CBA provides a sandbox (bpoint.uat.linkly.com.au) — need access credentials for development

---

## SMS Provider Comparison (For Later Decision)

| Provider | Pros | Cons | AU SMS Cost |
|----------|------|------|-------------|
| **Twilio** | Best docs/API, global reliability, Vercel-friendly | US-based, slightly pricier | ~$0.0750/SMS |
| **MessageMedia** | AU-owned, local support, good API | Less developer tooling | ~$0.05-0.06/SMS |
| **BurstSMS** | AU-owned, simplest API, cheapest | Smaller ecosystem | ~$0.045/SMS |

---

## Effort & Cost Analysis

### BPoint vs Stripe Effort Comparison

| Task | Stripe (original) | BPoint In-Page |
|------|-------------------|----------------|
| Payment form component | 4-6 hrs (SDK helps) | 6-10 hrs (no SDK, manual REST) |
| Webhook handling | 2-3 hrs | 3-4 hrs |
| Testing/sandbox | 2-3 hrs | 3-5 hrs (thinner docs) |
| **Total** | **~8-12 hrs** | **~12-19 hrs** |
| **Delta** | — | **~4-7 extra hours** |

**Note:** The gap is smaller than a full redirect-based HPP integration because BPoint's In-Page JS embed mirrors Stripe Elements architecturally. The extra effort comes purely from no SDK + sparser documentation.

### SMS Integration Effort

| Task | Hours |
|------|-------|
| SMS provider setup + API integration | 2-3 hrs |
| Send solicitor SMS on urgent payment | 1-2 hrs |
| Send visitor confirmation SMS | 1 hr |
| Error handling / retry logic | 1-2 hrs |
| **Total** | **~5-8 hours** |

### Cost Recommendation

- **BPoint delta (4-7 hrs):** Absorb or minimal surcharge — client is paying for payment integration regardless, and BPoint is their requirement for compliance reasons.
- **SMS integration (5-8 hrs):** Complimentary — goodwill gesture, small scope, and the client specifically requested it.
- **Ongoing SMS cost:** ~$0.05-0.08 per SMS sent. Negligible at expected volume but client should be aware.

---

## BPoint Inline Embed — Technical Verification (2026-04-13)

### Confirmed: BPoint v5 supports inline embed — no redirect required.

BPoint offers **three** inline methods, all rendering inside your page:

| Method | How it works | Best for |
|--------|-------------|----------|
| **Iframe Fields** | Each card field (number, expiry, CVV, name) renders as its own iframe inside divs you control | Maximum styling control — recommended for chat widget |
| **JS Simple** | BPoint generates entire form into a single `<div>` via `appendToElementId` | Fastest implementation |
| **JS Advanced** | Same as Simple but with more event/field control | Custom validation logic |

All require: `<script src="https://www.bpoint.com.au/rest/clientscripts/api.js">`

### Styling

- **Iframe Fields**: Style container divs with your own CSS. BPoint accepts a `styles` object for inner iframe content (font, color, size) with state variants (focus, valid, invalid). CSS classes applied to container for state changes.
- **JS Simple**: BPoint provides default `api.css`, or use your own.
- **Limitation**: Only a subset of CSS works inside iframes — not arbitrary CSS. Font, color, size are confirmed.

### Integration Flow (AuthKey pattern)

1. Server creates AuthKey via REST API call to BPoint
2. AuthKey passed to client-side JavaScript
3. Client JS renders payment fields in designated `<div>` inside chat
4. User enters card details (within secure BPoint iframes)
5. On submit: client-side callback fires immediately with result
6. Server-side webhook fires separately for confirmation

### Requirements & Restrictions

- **HTTPS mandatory** — Vercel deployment is HTTPS, no issue
- **No domain whitelisting** — API uses `Access-Control-Allow-Origin: *`, AuthKey is the security mechanism
- **Webhook source IPs** must be accepted: `203.195.127.4` and `202.166.187.3` (production)
- **Sandbox environment**: `bpoint.uat.linkly.com.au`

### Known Gotchas

1. **Webhook deduplication is on us** — BPoint may send duplicate webhooks. Must deduplicate by `txnNumber`
2. **Webhook retry**: 1-hour intervals for 24 hours if delivery fails
3. **3D Secure**: If active, cardholder `name` field must be enabled — fails silently otherwise
4. **Selector matching is strict** — if div IDs don't exactly match JS config, fields don't render (no error thrown)
5. **China UnionPay**: Always returns pending, must poll via Search Transaction API (edge case, unlikely relevant)
6. **Multi-step flow** — more steps than Stripe's single `clientSecret` pattern (create authkey → attach details → attach payment method → process)

### Sources

- [BPoint Iframe Fields](https://www.bpoint.com.au/developers/v5/api/token/authkey/payment-method/iframe-fields)
- [BPoint JS Simple](https://www.bpoint.com.au/developers/v5/api/txn/authkey/payment-method/javascript/simple)
- [BPoint JS Advanced](https://www.bpoint.com.au/developers/v5/api/txn/authkey/payment-method/javascript/advanced)
- [BPoint Developer Reference v5](https://www.bpoint.com.au/developers/v5/api)

---

## Prerequisite Checklist (For Client)

### Credentials & Technical

- [x] BPoint merchant facility credentials — **Received** (Merchant: AQUARIUS CONSULTING GROUP PTY LTD). Store in env vars, never in code.
- [x] Confirm the nominated bank account for BPoint settlement — **Confirmed: 10226910** (Aquarius Law General Account, BSB 062703). Note: Client has chosen to settle into general account rather than trust directly. Their stated rationale for BPoint is faster settlement "to assist with necessary Trust Accounting" — presumably they handle the general-to-trust transfer on their end per their internal compliance workflow. Not our concern to police; just ensure BPoint credentials and API are wired to settle correctly.
- [x] Confirm solicitor SMS number: +61 450533474 — **Confirmed**
- [ ] Approve SMS wording for both solicitor and visitor messages
- [ ] Provide BPoint sandbox/test credentials for development (production credentials received; need UAT/sandbox access separately)

### Integrations & Access

- [x] **Point of contact** — **Julie Bargenquast** | marketing@aquariuslawyers.com.au | 02 8858 3233
- [✅] **Zapier + Smokeball session** — Tuesday 2PM proposed (combined). Need to confirm specific Tuesday.
- [ ] **Calendly scheduling link** — Coming from Katherine (awaiting)
- [x] **Email destination** — info@aquariuslawyers.com.au confirmed
- [✅] **Resend API key** — Not needed from client; we provision. Client needs to confirm sending domain for DNS setup (SPF/DKIM).

## Additional Requirements (From Client — 2026-04-14)

### 3. Invoice Generation — RESOLVED (No Extra Dev Work)

Client requires a **copy of the invoice** for each payment, sent to **both client and firm**.

**Resolution:** Smokeball handles invoicing natively — it has built-in legal billing with automatic time tracking, flexible billing (hourly, fixed-fee, contingency), batch billing, and payment/trust management. It also integrates with QuickBooks for accounting.

**Our responsibility:** Ensure the Zapier webhook payload includes sufficient data for Smokeball to generate the invoice:
- Client name, email, phone
- Matter type and description
- Urgency tier and amount paid (inc. GST)
- BPoint transaction reference
- Payment date/timestamp

This data is already part of the planned webhook payload — no additional development required. Smokeball generates and sends the invoice to both client and firm from its end.
