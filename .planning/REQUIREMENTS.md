# Requirements: BPoint Payment Integration

**Defined:** 2026-04-23
**Core Value:** Lawyers can accept BPoint payments from clients directly in the chat, with payment status triggering downstream workflows to Smokeball CRM via Zapier.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Session & API Client

- [x] **SESS-01**: BPoint API client module (`src/lib/bpoint.ts`) authenticates with `username|merchantnumber:password` Basic Auth header format
- [x] **SESS-02**: AuthKey session endpoint creates one-time auth key with amount in integer cents, Crn1=sessionId, and RedirectionUrl
- [x] **SESS-03**: Existing two-tier pricing preserved (Urgent $1,320 AUD, Non-Urgent $726 AUD) with exact `lineItem` strings maintained for Smokeball reconciliation
- [x] **SESS-04**: `IsTestTxn` flag strictly controlled by environment — never leaks into production
- [x] **SESS-05**: AuthKey session expires after 30 minutes matching existing Stripe session TTL

### Payment UI (Client)

- [x] **UI-01**: PaymentCard component replaces Stripe Embedded Checkout with BPoint iframe/JS payment form
- [x] **UI-02**: User sees clear failure messages mapped from BPoint response codes (declined card, invalid card, system error)
- [x] **UI-03**: CSP headers allow BPoint iframe/JS origins
- [x] **UI-04**: Payment UI handles AuthKey expiry gracefully (user can retry)

### Payment Confirmation

- [x] **CONF-01**: GET `/api/checkout/confirm` route handles browser redirect with ResultKey query parameter
- [x] **CONF-02**: Server-side call to BPoint "Retrieve Transaction Result" API verifies authoritative payment status
- [x] **CONF-03**: Dual verification required — both `ResponseCode === "0"` AND `Approved === true` must be true to mark paid
- [x] **CONF-04**: On successful verification, triggers existing fan-out: session update → upload token → receipt email → firm transcript email (Zapier)
- [x] **CONF-05**: Redis deduplication prevents duplicate email/token creation on redirect replay

### Webhook (Server-to-Server Callback)

- [x] **WEBH-01**: POST `/api/webhooks/bpoint` handler receives BPoint server-to-server callback
- [x] **WEBH-02**: Webhook calls Retrieve Transaction Result API — does NOT trust callback payload alone
- [x] **WEBH-03**: Shared `handleConfirmedPayment()` helper used by both redirect confirm route and webhook for consistent behavior
- [x] **WEBH-04**: Webhook always returns 200 (even on internal errors) to prevent retry storms, with errors logged

### Data Schema

- [x] **DATA-01**: Session schema field renamed from `stripeSessionId` to `bpointTxnNumber` across types, Redis session, intake, and email modules
- [x] **DATA-02**: Zapier-monitored transcript email fields updated to use BPoint transaction identifiers while preserving field structure
- [x] **DATA-03**: `paymentAmount` field stores integer cents matching existing schema

### Stripe Removal

- [ ] **CLEAN-01**: Stripe npm packages (`stripe`, `@stripe/stripe-js`, `@stripe/react-stripe-js`) removed from dependencies
- [x] **CLEAN-02**: Stripe code deleted (`src/lib/stripe.ts`, `src/app/api/webhooks/stripe/route.ts`, Stripe-specific env vars)
- [ ] **CLEAN-03**: Stripe environment variables removed from documentation and deployment config

### Validation & Go-Live

- [ ] **TEST-01**: End-to-end test against BPoint UAT environment (`bpoint.uat.linkly.com.au`) succeeds with real test transactions
- [ ] **TEST-02**: Zapier → Smokeball invoice sync verified — line items reconcile correctly with BPoint receipt data
- [ ] **TEST-03**: Failure paths tested — declined card, expired AuthKey, webhook retry, redirect without callback

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Resilience & Recovery

- **RESL-01**: Search Transactions API fallback for session-limbo recovery (redirect received but no callback)
- **RESL-02**: Email-based payment resume flow for clients who close browser mid-payment

### Refunds

- **REFD-01**: Programmatic refund endpoint (BPoint Credit transaction) for dispute handling
- **REFD-02**: Refund status sync to Smokeball via Zapier

### Tokenization

- **TOKN-01**: BPoint token storage for returning clients (repeat payments without re-entering card)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| 3D Secure (3DS) verification | BPoint does not support 3DS 1 or 3DS 2 |
| Automatic card surcharges | Breaks fixed pricing model; firm absorbs processing fees |
| AMEX support | Requires separate merchant agreement; out of scope |
| Admin dashboard | All payment data flows to Smokeball via Zapier — no internal admin UI |
| Raw card data handling | PCI DSS prohibits; BPoint JS keeps cards off application server |
| Continuous payment status polling | Race conditions and unnecessary API load; single fallback only in v2 |
| PowerBoard migration | BPoint sunset is future concern; migrate when CBA provides timeline |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SESS-01 | Phase 1 | Complete |
| SESS-02 | Phase 1 | Complete |
| SESS-03 | Phase 1 | Complete |
| SESS-04 | Phase 1 | Complete |
| SESS-05 | Phase 1 | Complete |
| DATA-01 | Phase 1 | Complete |
| DATA-02 | Phase 1 | Complete |
| DATA-03 | Phase 1 | Complete |
| CONF-01 | Phase 2 | Complete |
| CONF-02 | Phase 2 | Complete |
| CONF-03 | Phase 2 | Complete |
| CONF-04 | Phase 2 | Complete |
| CONF-05 | Phase 2 | Complete |
| UI-01 | Phase 2 | Complete |
| UI-02 | Phase 2 | Complete |
| UI-03 | Phase 2 | Complete |
| UI-04 | Phase 2 | Complete |
| WEBH-01 | Phase 3 | Complete |
| WEBH-02 | Phase 3 | Complete |
| WEBH-03 | Phase 3 | Complete |
| WEBH-04 | Phase 3 | Complete |
| CLEAN-01 | Phase 3 | Pending |
| CLEAN-02 | Phase 3 | Complete |
| CLEAN-03 | Phase 3 | Pending |
| TEST-01 | Phase 4 | Pending |
| TEST-02 | Phase 4 | Pending |
| TEST-03 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 27 total
- Mapped to phases: 27
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-23*
*Last updated: 2026-04-23 — traceability mapped after roadmap creation*
