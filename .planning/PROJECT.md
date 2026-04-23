# BPoint Payment Integration

## What This Is

Replace Stripe with BPoint as the payment processor for the lawyers' chat. Clients select their urgency level (urgent or non-urgent), see the pricing, and complete payment via BPoint's embedded checkout form before proceeding with the legal matter intake.

## Core Value

Lawyers can accept BPoint payments from clients directly in the chat, with payment status triggering downstream workflows to Smokeball CRM via Zapier.

## Requirements

### Validated

- ✓ Chat payment flow (client sees urgency selection → pricing → payment UI) — existing
- ✓ Two pricing tiers (Urgent: $1,320 AUD, Non-Urgent: $726 AUD) — existing
- ✓ Payment receipt emails sent to clients — existing
- ✓ Intake data captured (client name, email, phone, matter description, urgency) — existing
- ✓ Transcript emails sent to firm after payment — existing
- ✓ Upload tokens created for client document upload — existing
- ✓ Session data stored in Upstash Redis — existing

### Active

- [ ] Replace Stripe Embedded Checkout with BPoint embedded form/iframe in PaymentCard component
- [ ] Create BPoint session endpoint (replaces `/api/checkout` Stripe logic)
- [ ] Add BPoint webhook handler for payment verification
- [ ] Update payment receipt email templates to reflect BPoint (not Stripe)
- [ ] Store BPoint transaction IDs in session data (replace stripeSessionId)
- [ ] Handle BPoint payment failures and refund scenarios
- [ ] Ensure lineItem and tier data flow correctly to BPoint receipt and Smokeball invoice

### Out of Scope

- Admin dashboard — all payment data flows to Smokeball via Zapier
- Mobile app — web chat only
- Multiple payment methods — BPoint only

## Context

**Tech Stack:**
- Next.js 15+ with TypeScript
- Vercel AI SDK v6 (Gemini 2.5 Flash via OpenRouter)
- Upstash Redis for session storage (replaces deprecated Vercel KV)
- Resend for email delivery
- Zapier for Smokeball CRM sync
- Currently uses Stripe for payments

**Integration Points:**
- Session manager: stores payment status, transaction IDs, payment amount
- Webhook: receives payment confirmation, triggers upstream workflows
- Email: payment receipts and firm notifications
- CRM sync: Zapier syncs payment data to Smokeball invoice line items

**Existing Flow:**
1. Chat prompts client for urgency (urgent/non-urgent)
2. Client confirms pricing disclosure
3. Client clicks "Pay now" → PaymentCard component renders
4. Client enters payment details in Stripe Embedded Checkout
5. Stripe webhook confirms payment → session marked paid
6. Upload token created → client sent receipt email
7. Firm notified via transcript email (which Zapier picks up)

## Constraints

- **Legal Compliance**: `lineItem` must remain exact (flows to Smokeball invoice for reconciliation) — cannot paraphrase
- **Currency**: AUD only
- **Session TTL**: Payment form must expire after 30 minutes
- **Webhook Deduplication**: Must prevent duplicate email/token creation on webhook retries
- **Smokeball Sync**: Zapier monitoring transcript emails for payment data — must maintain current field structure

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Replace Stripe with BPoint (embedded iframe) | Client requirement; embedded approach matches existing UX | — Pending |
| Maintain lineItem and tier structure | Smokeball invoice reconciliation depends on exact descriptions | — Pending |
| Keep session/webhook architecture | Existing architecture is sound; only swap provider logic | — Pending |

---
*Last updated: 2026-04-23 after initialization*
