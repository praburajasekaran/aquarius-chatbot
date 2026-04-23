# Feature Research

**Domain:** BPoint payment gateway integration — Australian legal firm chat payment flow
**Researched:** 2026-04-23
**Confidence:** MEDIUM (BPoint API docs partially accessible; core capabilities confirmed via official developer portal + third-party integration docs; some specifics like exact webhook payload schema require direct API access)

---

## Context: What We Are Replacing

Stripe Embedded Checkout provides: server-side session creation, client-side iframe rendering, signed webhook events with signature verification, automatic receipt emails, full refund/partial refund API, and 3D Secure 2.

BPoint is Commonwealth Bank's legacy payment gateway (existing-customer product — closed to new signups as of 2025/2026 while CBA rolls out PowerBoard as the successor). The firm already holds a BPoint facility; this milestone is purely a provider swap, not a product choice.

---

## Feature Landscape

### Table Stakes (Must Have for Legal Payment Processing)

These are non-negotiable. Missing any one of these blocks go-live.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| AUD currency processing | All prices are AUD; no multi-currency needed | LOW | BPoint natively processes AUD. `CurrencyCode: "AUD"` in transaction request. MEDIUM confidence — confirmed in API examples. |
| Embedded/iframe payment form | Current UX keeps client in chat; redirect would break the flow | MEDIUM | BPoint v5 offers JavaScript Simple and Advanced integration modes. The JavaScript library renders card fields in-page. Server creates an AuthKey, JS uses it to capture card data without full redirect. Replaces Stripe's embedded element approach. |
| Server-side payment session creation | Needed to set amount, description, and prevent tampering | MEDIUM | BPoint AuthKey endpoint: server POSTs to create a one-time AuthKey tied to transaction details (amount, merchant ref, redirection URL). Equivalent to Stripe's `checkout.sessions.create`. |
| Payment confirmation callback (webhook) | Session must be marked paid before upload token is created | MEDIUM | BPoint supports two confirmation paths: (1) browser redirect with `ResultKey` param, (2) optional server-to-server callback URL. The server uses ResultKey or callback to call "Retrieve Transaction Result". Not a signed HMAC webhook like Stripe — callback is a plain POST or GET to your configured URL. Deduplication must be handled by the application. |
| Transaction result retrieval | Must confirm payment actually cleared before triggering downstream | LOW | After receiving ResultKey or callback, server calls BPoint's "Retrieve Transaction Result" API to get authoritative payment status. This is the canonical confirmation step. |
| Refund capability | Payment failures and client disputes require refund path | MEDIUM | BPoint supports Credit (refund) transaction type against an original transaction. Requires original BPoint transaction reference. Not self-service in the chat — would be triggered by firm staff via Merchant Back Office or API. |
| Test/sandbox environment | Must be able to validate integration without real charges | LOW | BPoint provides a UAT (User Acceptance Testing) environment at `bpoint.uat.linkly.com.au`. Test mode uses specific amounts/card numbers to simulate response codes 00–99. |
| Transaction receipt / reference ID | Required for Smokeball invoice reconciliation | LOW | BPoint returns a `ReceiptNumber` and `TransactionId` in the transaction response. Store in Redis session replacing `stripeSessionId`. These IDs flow to Smokeball via Zapier. |
| Failure handling and response codes | Users must get clear messaging on decline | LOW | BPoint returns bank response codes (00 = approved, others = various declines). The integration must map these to user-facing messages in the chat UI. |
| Visa and Mastercard acceptance | Standard Australian payment cards | LOW | Confirmed: BPoint accepts Visa and Mastercard. Relevant for the firm's client base. |

### Differentiators vs Stripe (What BPoint Does Differently)

These are not features to celebrate — they are differences the implementation must accommodate.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| No automatic receipt emails | BPoint does not send cardholder receipts natively | LOW | Stripe sent receipt emails automatically. With BPoint, the existing Resend-based receipt email flow remains entirely under application control. This is actually cleaner — no duplicate emails. No change needed to email logic, only to payment status trigger. |
| Merchant Back Office for manual ops | Refunds and transaction searches can be done via GUI without API | LOW | BPoint's web back office lets firm staff look up transactions, issue refunds, and download reports without developer involvement. Useful for edge cases. Stripe had a similar dashboard. |
| CBA banking relationship | Funds settle into CBA merchant account directly | LOW | Relevant for the firm's reconciliation — settlement is via their existing CBA banking relationship, which may simplify monthly reconciliation vs Stripe's separate payouts. |
| Australian-hosted infrastructure | Payment data stays within Australian regulatory boundary | LOW | MEDIUM confidence. BPoint operates in the Asia-Pacific region under CBA's infrastructure. Relevant for any future data residency requirements. |

### Anti-Features (Do Not Build or Rely On)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| 3D Secure (3DS) enforcement | Seems like fraud protection | BPoint does NOT support 3DS 1 or 3DS 2 per Spreedly integration documentation. Building a 3DS verification step will fail. | Accept that fraud liability rules differ — BPoint handles fraud risk via CBA's network rules. Do not add 3DS logic. |
| Treating BPoint callback as a signed webhook (like Stripe) | Security instinct — verify the event source | BPoint's callback is not cryptographically signed the way Stripe webhooks are (HMAC-SHA256 signature header). Relying on callback alone without calling "Retrieve Transaction Result" is insecure. | Always call the Retrieve Transaction Result API after receiving any callback or ResultKey to get authoritative status. Use idempotency key (session ID) to prevent duplicate processing. |
| Automatic surcharge pass-through to client | Card surcharges are visible on BPoint merchant pages | Surcharge rates vary (Visa/MC ~1.27–1.48%, Amex ~1.95–2.35%). Adding surcharges changes the final charge amount, breaking the fixed $1,320/$726 AUD pricing tiers. | Keep firm absorbing processing fees. Fixed pricing is a product requirement — do not implement variable surcharges. |
| AMEX acceptance | Broader card acceptance | AMEX has higher surcharge (~2.35%) and requires separate merchant agreement. Out of scope per PROJECT.md (BPoint only, fixed pricing). | Visa/Mastercard only is sufficient for Australian legal clients. |
| Storing raw card data | Might seem needed for tokenization | PCI DSS prohibits storing PANs. BPoint's JS library handles card capture in-page; card data never touches the application server. | Use BPoint tokens for any future repeat-payment scenarios. Do not handle card data server-side. |
| Polling for payment status | Fallback if webhook is missed | Polling creates race conditions and unnecessary API load | BPoint documents that if neither callback nor redirect is received, a Search Transactions call should be used as a one-time fallback — not continuous polling. Implement a single fallback check on session resume, not a polling loop. |

---

## Feature Dependencies

```
AuthKey creation (server)
    └──requires──> BPoint merchant credentials (MerchantNumber, Username, Password)
                       └──requires──> Active BPoint facility (firm must have this)

JavaScript payment capture (client)
    └──requires──> AuthKey

Transaction result retrieval (server)
    └──requires──> ResultKey (from browser redirect) OR callback received

Session marked paid
    └──requires──> Transaction result retrieval confirmed approved

Upload token creation
    └──requires──> Session marked paid

Receipt email (Resend)
    └──requires──> Session marked paid

Smokeball CRM sync (Zapier)
    └──requires──> Transcript email (which requires session marked paid)

Webhook deduplication
    └──enhances──> Session marked paid (prevents double-processing on retry)
```

### Dependency Notes

- **AuthKey requires active BPoint facility:** The firm must provide their `MerchantNumber`, API username, and API password. These are configured via BPoint Merchant Back Office by an Administrator or Manager user. Without credentials, development cannot proceed against even the UAT environment.
- **Transaction result retrieval requires ResultKey:** The ResultKey is passed as a query parameter in the browser redirect to the `RedirectionUrl`. The server must capture this from the Next.js route handler and call BPoint's Retrieve API. This is the critical path — do not skip it.
- **Deduplication enhances session marking:** Because BPoint callbacks can fire more than once (network retries), the Redis session state check (`if (session.paid) return 200`) is the deduplication gate. This must be implemented before triggering any downstream side effect.

---

## MVP Definition

### Launch With (v1)

Minimum viable to replace Stripe and restore full payment functionality:

- [ ] BPoint AuthKey session endpoint — replaces `/api/checkout`, creates one-time auth key with fixed amount and merchant reference
- [ ] BPoint JavaScript integration in PaymentCard component — replaces Stripe Embedded Checkout iframe, renders card fields using BPoint JS library
- [ ] Retrieve Transaction Result handler — server-side call to confirm payment approval after redirect/callback
- [ ] Webhook/callback handler — receives BPoint server-to-server callback, calls Retrieve, marks session paid with BPoint transaction ID
- [ ] Idempotency guard in callback handler — Redis check prevents duplicate email/token creation on webhook retry
- [ ] Replace `stripeSessionId` with `bpointTransactionId` in session schema — maintains Smokeball data flow
- [ ] Failure response mapping — map BPoint response codes to user-facing decline messages in chat UI
- [ ] UAT environment smoke test — end-to-end test against BPoint UAT before prod cutover

### Add After Validation (v1.x)

- [ ] Search Transactions fallback — if session is in limbo (redirect received but no callback, or callback missed), a single fallback call to BPoint Search API resolves ambiguity. Add after basic flow is proven.
- [ ] Refund API integration — programmatic refund via BPoint API for dispute handling. Currently manual via Back Office; automate when firm requests it.

### Future Consideration (v2+)

- [ ] BPoint token storage for returning clients — BPoint supports tokenising card details for repeat payments. Defer until repeat-client payment use case is confirmed as a requirement.
- [ ] PowerBoard migration — CBA is replacing BPoint with PowerBoard for new customers. If the firm's BPoint facility is ever sunset, migration to PowerBoard would be the upgrade path. Not imminent; monitor CBA communications.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| AuthKey session creation endpoint | HIGH | LOW | P1 |
| BPoint JS payment form (PaymentCard) | HIGH | MEDIUM | P1 |
| Transaction result retrieval | HIGH | LOW | P1 |
| Callback handler + idempotency | HIGH | MEDIUM | P1 |
| Failure/decline messaging | HIGH | LOW | P1 |
| UAT smoke test | HIGH | LOW | P1 |
| Search Transactions fallback | MEDIUM | LOW | P2 |
| Refund API integration | MEDIUM | MEDIUM | P2 |
| BPoint token storage | LOW | MEDIUM | P3 |
| PowerBoard migration path | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

---

## Stripe vs BPoint Comparison (Replacement Map)

| Stripe Concept | BPoint Equivalent | Difference |
|---------------|-------------------|------------|
| `checkout.sessions.create` | AuthKey creation POST | BPoint AuthKey is a one-time token, not a full session object. Amount and merchant reference are set at AuthKey creation time. |
| Stripe Embedded Checkout iframe | BPoint JS library (Simple or Advanced mode) | BPoint JS renders card fields in-page. Advanced mode gives more styling control. |
| `stripe.webhooks.constructEvent` (signed) | BPoint server-to-server callback + Retrieve Transaction Result API | BPoint callback is NOT signed. Must always call Retrieve API to confirm authenticity of payment status. |
| Stripe receipt email (automatic) | No equivalent — application handles via Resend | Existing Resend flow is unchanged; only the trigger (payment confirmed) changes. |
| `payment_intent.id` / `session.id` | `ReceiptNumber` + `TransactionId` | Both BPoint IDs should be stored; TransactionId is used for refunds, ReceiptNumber is human-readable for Smokeball. |
| Stripe refund API | BPoint Credit transaction type | BPoint credit requires original TransactionId. Partial refunds supported. |
| Stripe dashboard | BPoint Merchant Back Office | Similar capability for manual ops and transaction search. |
| 3D Secure 2 | NOT SUPPORTED | BPoint does not support 3DS. No equivalent. |
| Test cards (Stripe) | BPoint UAT environment + test amounts | BPoint uses specific transaction amounts (or card numbers) to trigger specific response codes in UAT. |

---

## Compliance and Legal Considerations (Australian Context)

- **PCI DSS**: BPoint's JavaScript integration keeps card data off the application server — card fields render in BPoint's JS context. Application server only handles AuthKeys and transaction IDs. This maintains PCI DSS SAQ A-EP or SAQ A scope (do not handle raw card data server-side under any circumstances).
- **ACCC Surcharge Rules**: Australia prohibits excessive surcharges (must not exceed cost of acceptance). The firm absorbs fees at fixed pricing — no surcharge passed to clients — so ACCC surcharge rules do not apply to this implementation.
- **AML/KYC**: Legal payments in Australia may be subject to anti-money laundering obligations under the AML/CTF Act. BPoint processing does not substitute for the firm's own KYC obligations — out of scope for this integration.
- **Trust Account Compliance**: The current implementation collects consultation fees (not trust/matter funds). Confirm with the firm that these payments do not need to go into a trust account — if they do, BPoint/payment gateway choice does not resolve trust accounting compliance; that requires legal practice management integration.
- **BPoint Product Status**: BPoint is an existing-customer product (closed to new merchants). The firm holds an active facility. This integration is valid and supported for existing customers. Monitor CBA communications for any sunsetting timeline.

---

## Sources

- [BPoint Developer Reference v5](https://www.bpoint.com.au/developers/v5/api) — official API documentation (MEDIUM confidence, partially accessible)
- [BPoint Transaction Flow v5](https://www.bpoint.com.au/developers/v5/api/txn/flow) — AuthKey + JS integration flow
- [BPoint JavaScript Simple Integration](https://www.bpoint.com.au/developers/v5/api/txn/authkey/payment-method/javascript/simple) — in-page card capture
- [BPoint Gateway Guide — Spreedly](https://docs.spreedly.com/payment-gateways/bpoint/) — supported operations (Purchase, Authorize, Capture, Refund, Void, Verify, Store); 3DS not supported
- [CBA BPoint product page](https://www.commbank.com.au/business/payments/take-online-payments/bpoint-payment-gateway.html) — product status (existing customers only)
- [BPoint v3 3-party JS process payment](https://bpoint.com.au/developers/v3/partialViews/Sections/threepartypaymentjsa/section.html) — ResultKey + server-to-server callback flow
- [BPoint v5 Bank Response Codes](https://www.bpoint.com.au/developers/v5/reference/bank-response-codes) — response code reference
- [BPoint Test Mode](https://www.bpoint.com.au/developers/v5/reference/test-mode) — UAT environment details
- [ACCC Card Surcharges](https://www.accc.gov.au/consumers/pricing/card-surcharges) — Australian surcharge regulation

---

*Feature research for: BPoint payment gateway (Aquarius Lawyers chatbot — Stripe replacement)*
*Researched: 2026-04-23*
