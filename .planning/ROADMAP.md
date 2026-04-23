# Roadmap: BPoint Payment Integration

## Overview

Replace Stripe with BPoint as the payment processor for the lawyers' chat. The migration follows four phases: build the server-side API client and type foundation, wire the confirmation flow and client-facing iframe, add the webhook secondary path and remove Stripe, then gate on UAT end-to-end validation before production cutover.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation** - BPoint API client, type renames, session endpoint, pricing constants
- [ ] **Phase 2: Confirmation & UI** - Confirm route, PaymentCard iframe, failure messaging
- [ ] **Phase 3: Webhook & Cleanup** - Webhook handler, shared helper, Stripe removal
- [ ] **Phase 4: Validation** - UAT E2E tests, Zapier/Smokeball verification, failure path testing

## Phase Details

### Phase 1: Foundation
**Goal**: The server can create a valid BPoint AuthKey and all session types use BPoint identifiers
**Depends on**: Nothing (first phase)
**Requirements**: SESS-01, SESS-02, SESS-03, SESS-04, SESS-05, DATA-01, DATA-02, DATA-03
**Success Criteria** (what must be TRUE):
  1. A curl call to POST /api/checkout returns an authKey UUID (not a Stripe clientSecret)
  2. The BPoint AuthKey is created with the correct amount in integer cents ($132000 for Urgent, $72600 for Non-Urgent)
  3. No TypeScript errors exist across the codebase — stripeSessionId has been fully replaced by bpointTxnNumber in all types, Redis session, intake, and email modules
  4. The IsTestTxn flag is false in production environment and true only in non-production — confirmed by environment check
  5. The AuthKey session expires after 30 minutes, consistent with the existing Stripe session TTL
**Plans**: TBD

### Phase 2: Confirmation & UI
**Goal**: Clients can enter card details in the embedded BPoint iframe and payment confirmation is verified server-side
**Depends on**: Phase 1
**Requirements**: CONF-01, CONF-02, CONF-03, CONF-04, CONF-05, UI-01, UI-02, UI-03, UI-04
**Success Criteria** (what must be TRUE):
  1. The PaymentCard component renders a BPoint iframe (not Stripe EmbeddedCheckout) and the card entry form is visible in the chat
  2. After entering card details and clicking Pay, the browser is redirected to /api/checkout/confirm with a ResultKey parameter and the server verifies the transaction with BPoint's API before marking the session paid
  3. A successful payment triggers the existing fan-out: upload token created, receipt email sent to client, transcript email sent to firm
  4. A declined or invalid card shows a human-readable failure message in the chat UI (not a raw BPoint response code)
  5. An expired AuthKey allows the user to retry — the UI handles expiry gracefully without an unrecoverable error state
**Plans**: TBD

### Phase 3: Webhook & Cleanup
**Goal**: BPoint server-to-server callbacks are handled safely and all Stripe code is removed from the codebase
**Depends on**: Phase 2
**Requirements**: WEBH-01, WEBH-02, WEBH-03, WEBH-04, CLEAN-01, CLEAN-02, CLEAN-03
**Success Criteria** (what must be TRUE):
  1. POST /api/webhooks/bpoint receives a BPoint callback, verifies the transaction via the Retrieve Transaction API, and triggers fan-out — without duplicating emails or tokens when retried
  2. The confirm route and webhook handler share the same handleConfirmedPayment() helper — fan-out logic is not duplicated across the two paths
  3. The Stripe packages (stripe, @stripe/stripe-js, @stripe/react-stripe-js) are absent from package.json and the build completes without errors
  4. Stripe source files (src/lib/stripe.ts, src/app/api/webhooks/stripe/route.ts) no longer exist in the codebase
**Plans**: TBD

### Phase 4: Validation
**Goal**: The complete BPoint payment flow is verified end-to-end against UAT before production cutover
**Depends on**: Phase 3
**Requirements**: TEST-01, TEST-02, TEST-03
**Success Criteria** (what must be TRUE):
  1. A real test transaction completes end-to-end against BPoint UAT — client enters card, payment is confirmed, receipt email arrives, upload token is created
  2. Zapier picks up the transcript email and the Smokeball invoice line items reconcile correctly with BPoint receipt data — correct amounts and exact lineItem strings
  3. A declined card, an expired AuthKey, a replayed redirect, and a webhook retry all behave correctly — no duplicate emails, no false confirmations, no unhandled errors
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 0/TBD | Not started | - |
| 2. Confirmation & UI | 0/TBD | Not started | - |
| 3. Webhook & Cleanup | 0/TBD | Not started | - |
| 4. Validation | 0/TBD | Not started | - |
