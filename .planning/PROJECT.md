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
- ✓ Replace Stripe Embedded Checkout with BPoint iframe in PaymentCard — Validated in Phase 2: confirmation-ui
- ✓ `/api/checkout` BPoint session endpoint (returns `{ authKey }`, 502 on BPoint failure) — Validated in Phase 1 + 2
- ✓ Store BPoint transaction IDs in session data (replace `stripeSessionId`) — Validated in Phase 2 (confirm route persists `bpointTxnNumber` via shared fan-out helper)
- ✓ Handle BPoint payment failures (4 sanitized buckets: declined/invalid/system/expired) — Validated in Phase 2: confirmation-ui

### Active

- [ ] Add BPoint webhook handler for payment verification (Phase 3 — webhook & cleanup)
- [ ] Update payment receipt email templates to reflect BPoint (not Stripe) (partially phase 1; full validation in Phase 3 + UAT)
- [ ] Ensure lineItem and tier data flow correctly to BPoint receipt and Smokeball invoice (Phase 4 UAT)

### External Dependencies (blocks live verification)

- BPoint Hosted Payment Page product activation at merchant facility level (merchant 5353109297032146) — action: call BPoint support 1300 766 031, Support Code 273 516. Blocks end-to-end iframe render verification for Phases 2+.

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
| Replace Stripe with BPoint (embedded iframe) | Client requirement; embedded approach matches existing UX | ✓ Shipped (Phase 2) |
| Maintain lineItem and tier structure | Smokeball invoice reconciliation depends on exact descriptions | — Pending Phase 4 UAT |
| Keep session/webhook architecture | Existing architecture is sound; only swap provider logic | ✓ Confirmed (Phase 2 — `handleConfirmedPayment` shared between confirm route + upcoming Phase 3 webhook) |
| 4 sanitized failure buckets (declined/invalid/system/expired) | Bank codes must not leak to UI; expired AuthKey needs retry path | ✓ Shipped (Phase 2-04) |
| GET /api/checkout/confirm for BPoint browser redirect | BPoint iframe redirects the top frame; requires a server-side landing route with dual verification + Redis SETNX dedup | ✓ Shipped (Phase 2-03) |

## Current State

- **Phase 1: foundation** — ✓ Complete (BPoint AuthKey client, PRICING, intake data, Stripe removal). External blocker: BPoint HPP product activation at facility level.
- **Phase 2: confirmation-ui** — ✓ Complete (2026-04-24). BPoint iframe PaymentCard, confirm route, failure buckets, chat-widget URL-param wiring. Iframe-render live smoke test deferred to external blocker resolution.
- **Phase 3: webhook-&-cleanup** — Next.

---
*Last updated: 2026-04-24 after Phase 2 completion*
