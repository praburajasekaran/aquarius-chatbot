# Pitfalls Research

**Domain:** BPoint payment gateway integration — Next.js chat, Australian law firm, high-value AUD payments
**Researched:** 2026-04-23
**Confidence:** MEDIUM (BPoint docs are partially indexed by search engines; core API behaviour confirmed via official references and community integrations; session timeout specifics not publicly documented)

---

## Critical Pitfalls

### Pitfall 1: Trusting the Redirect URL as Payment Confirmation

**What goes wrong:**
After BPoint processes an iframe payment, it redirects the browser to the `RedirectionUrl` you supplied — appending `ResponseCode=0&ResponseText=Success&ResultKey=<uuid>` as query string parameters. Teams treat the arrival of the user at this URL as proof of payment and immediately provision access (upload token, receipt email, Smokeball trigger). A user who manually constructs that URL — or whose browser tab was shared — can trigger the entire downstream workflow without paying.

**Why it happens:**
Developers migrating from Stripe see the redirect-with-query-params pattern and mirror what they were doing with Stripe's `session_id` success URL — without recognising that BPoint's redirect parameters are **not cryptographically signed** and are trivially forgeable.

**How to avoid:**
Never act on the redirect URL parameters alone. Use the `ResultKey` from the query string only as a lookup handle. Make a **server-side API call** to BPoint's transaction search endpoint using the `ResultKey` to retrieve the canonical transaction record, and confirm `ResponseCode === "0"` and `Approved === true` in the server-side response before triggering any downstream action. The BPoint docs explicitly state: "if neither the redirection response nor the server-to-server callback are received, a Search Transactions call should be made to determine the transaction outcome."

```typescript
// Correct: server-side verification in the webhook/callback handler
const txn = await bpointClient.getTransaction(resultKey); // server-to-server
if (txn.ResponseCode !== "0" || !txn.Approved) {
  return res.status(400).json({ error: "Payment not confirmed" });
}
// Only now: mark session paid, send receipt, trigger Zapier
```

**Warning signs:**
- Your `/payment/success` route reads `req.query.ResponseCode` and acts on it directly
- No outbound HTTP call to BPoint in your success handler
- No BPoint API credentials present in your payment confirmation code path

**Phase to address:** Phase 1 — BPoint session creation and payment confirmation endpoint

**Impact if missed:** Clients receive legal consultation services and access tokens without payment. For $1,320 AUD "urgent" matters, even a single exploit causes material financial harm and a compliance incident for the law firm.

---

### Pitfall 2: Malformed Authentication Header

**What goes wrong:**
BPoint's REST API uses HTTP Basic Auth with a non-standard credential format: `username|merchantnumber:password` (pipe-separated username and merchant number, colon before password), then base64-encoded. Developers who use standard Basic Auth helpers (e.g., `btoa(username + ':' + password)`) produce a silently wrong header. BPoint returns HTTP 401, which is often misread as an environment or credential issue, burning days of debugging against the wrong hypothesis.

**Why it happens:**
Every standard library and tutorial for HTTP Basic Auth uses `username:password`. The pipe character separating username from merchant number is BPoint-specific and not obvious from error messages. The base64 value `dXNlcm5hbWV8bWVyY2hhbnRudW1iZXI6cGFzc3dvcmQ=` (from BPoint's own docs) decodes to `username|merchantnumber:password` — but developers do not check this.

**How to avoid:**
Encode credentials explicitly and test-decode to verify format before any integration work:

```typescript
const credentials = Buffer.from(
  `${username}|${merchantNumber}:${password}`
).toString("base64");
const headers = { Authorization: `Basic ${credentials}` };
```

Add a startup assertion in development that decodes the env var and logs the decoded string (never in production logs):

```typescript
// dev-only sanity check
if (process.env.NODE_ENV === "development") {
  const decoded = Buffer.from(process.env.BPOINT_AUTH_B64, "base64").toString();
  console.log("BPoint auth format check:", decoded.includes("|")); // must be true
}
```

**Warning signs:**
- Receiving HTTP 401 from BPoint APIs that are not credential-typed errors (missing fields)
- Auth credentials set via a standard `btoa(user + ':' + pass)` call

**Phase to address:** Phase 1 — BPoint API client setup and credential configuration

**Impact if missed:** All BPoint API calls fail. No AuthKey can be created, payment flow is completely blocked.

---

### Pitfall 3: Amount Transmitted as Dollars Instead of Integer Cents

**What goes wrong:**
BPoint's API expects `Amount` as an **integer in cents** (e.g., `132000` for $1,320.00 AUD). If the value is passed as a float (`1320.00`) or as a dollar-formatted string (`"1320"`), BPoint may reject the request or, worse, charge the client $13.20 — a 100x undercharge. For a law firm charging $1,320 or $726, this is a direct financial error that triggers reconciliation failures in Smokeball.

**Why it happens:**
The existing Stripe integration uses dollar amounts (Stripe uses cents too, but the mental model in the codebase may already use cents — or may not). Developers assume BPoint uses the same format as their prior gateway without verifying. The pricing constants in the codebase are likely stored as human-readable dollar values.

**How to avoid:**
Store pricing constants in cents from the source of truth and document the unit explicitly:

```typescript
// In your pricing config — name the unit to prevent ambiguity
const PRICING = {
  urgent:    { amountCents: 132000, label: "$1,320.00 AUD" },
  nonUrgent: { amountCents:  72600, label: "$726.00 AUD" },
} as const;

// When building BPoint AuthKey request body:
body.Amount = PRICING[tier].amountCents; // integer, no conversion needed
```

Add a runtime guard:

```typescript
if (!Number.isInteger(amount) || amount < 100) {
  throw new Error(`BPoint amount must be integer cents; received: ${amount}`);
}
```

**Warning signs:**
- Pricing constants defined as `1320` or `726` (dollars) rather than `132000` / `72600`
- Any `amount * 100` conversion happening at the API call site (conversion should be unnecessary if the source constant is already in cents)
- Decimal point present in the value passed to BPoint

**Phase to address:** Phase 1 — BPoint session (AuthKey) creation

**Impact if missed:** Clients charged $13.20 for urgent legal matters. Smokeball invoice line items show incorrect amounts. Financial reconciliation fails. Firm loses $1,306.80 per urgent transaction.

---

### Pitfall 4: No Webhook Deduplication — Duplicate Side Effects on Retry

**What goes wrong:**
BPoint's server-to-server callback (webhook) can be retried by BPoint on delivery failure (e.g., your endpoint timed out or returned non-2xx). Without deduplication, each retry triggers: a new receipt email to the client, a new upload token, and a new Zapier/Smokeball sync event. The client receives multiple emails. Smokeball creates duplicate invoice line items. This is particularly damaging for a law firm where invoice accuracy is a compliance requirement.

**Why it happens:**
The existing Stripe implementation likely uses Stripe's idempotency guarantees and event deduplication. BPoint's webhook does not provide an equivalent built-in guarantee. Developers swap the gateway assuming webhook behaviour is identical.

**How to avoid:**
Persist a "processed" flag keyed on the BPoint `TxnNumber` (the unique transaction identifier) in Upstash Redis with a TTL. Check before processing:

```typescript
const dedupeKey = `bpoint:txn:processed:${txnNumber}`;
const alreadyProcessed = await redis.get(dedupeKey);
if (alreadyProcessed) {
  return res.status(200).json({ status: "duplicate, ignored" });
}
// Set before side effects — not after (prevents race on concurrent retries)
await redis.set(dedupeKey, "1", { ex: 86400 }); // 24hr TTL
// Now: send email, create token, trigger Zapier
```

**Warning signs:**
- Webhook handler has no Redis read before triggering side effects
- Receipt email function is called directly in the webhook without idempotency check
- No `TxnNumber` being stored in session data

**Phase to address:** Phase 2 — Webhook handler implementation

**Impact if missed:** Clients receive duplicate receipt emails (poor UX, unprofessional for a law firm). Smokeball invoice data corrupted with duplicate line items. Upload tokens multiply unexpectedly.

---

### Pitfall 5: Checking Only ResponseCode, Not Both ResponseCode and Approved

**What goes wrong:**
BPoint returns two distinct success indicators: `ResponseCode` ("0" = API-level success) and `Approved` (boolean — bank-level authorisation). A transaction can have `ResponseCode: "0"` (the API call was valid and processed) but `Approved: false` (the bank declined the card). Checking only `ResponseCode === "0"` and proceeding with payment fulfilment means declined payments are treated as successful.

**Why it happens:**
`ResponseCode: "0"` is described as "Success" in BPoint docs, which reads as payment success. Developers stop checking at that point without reading further to find the `Approved` field. Community PHP integrations (omnipay-bpoint) expose this dual-check pattern in `Response.php`, but it is not obvious from the top-level docs.

**How to avoid:**
Always check both fields in your verification logic:

```typescript
function isBPointPaymentApproved(txn: BPointTxnResponse): boolean {
  return txn.APIResponse?.ResponseCode === "0" &&
         txn.TxnResp?.Approved === true;
}
```

Never short-circuit on `ResponseCode` alone. Log both values for every transaction for auditability.

**Warning signs:**
- Success check is a single `=== "0"` or `=== 0` condition with no `Approved` check
- No `Approved` field referenced anywhere in payment verification code

**Phase to address:** Phase 2 — Webhook handler and transaction verification logic

**Impact if missed:** Clients with declined cards receive upload tokens and legal matter confirmation. Firm performs legal work without payment. No charge reaches Smokeball for reconciliation.

---

### Pitfall 6: Missing CSP Directives Block the BPoint Iframe

**What goes wrong:**
Next.js applications with Content-Security-Policy headers will silently block the BPoint iframe from loading if `frame-src` does not explicitly allow `https://www.bpoint.com.au` and `https://bpoint.uat.linkly.com.au` (for UAT). The iframe renders as a blank white box. There are no visible errors in the application UI — the browser console shows a CSP violation, but users see nothing actionable.

**Why it happens:**
CSP headers are often set globally in `next.config.ts` or middleware and not revisited when adding third-party embeds. The team knows Stripe's embed domains but hasn't mapped BPoint's. The production domain and the UAT domain are different — forgetting the UAT domain breaks developer testing.

**How to avoid:**
Add BPoint domains to CSP in `next.config.ts` headers or middleware, covering both environments:

```typescript
// next.config.ts
const cspHeader = `
  frame-src 'self' https://www.bpoint.com.au https://bpoint.uat.linkly.com.au;
  connect-src 'self' https://www.bpoint.com.au https://bpoint.uat.linkly.com.au;
`;
```

Test CSP in development by opening the browser console and filtering for "Content-Security-Policy" before any other integration testing.

**Warning signs:**
- BPoint iframe renders blank or fails to load in development
- CSP header in the existing codebase was written for Stripe domains only
- No `frame-src` directive referencing bpoint.com.au

**Phase to address:** Phase 1 — PaymentCard component replacement (iframe embed)

**Impact if missed:** Payment UI silently broken for all users. Requires a deployment to fix, not just a code change in development.

---

### Pitfall 7: TestMode Flag Left Enabled in Production

**What goes wrong:**
BPoint has an explicit `IsTestTxn` field in transaction requests. When `true`, the transaction is visible in the BPoint backoffice but does NOT settle — no money is collected. If the flag is included in production payloads (e.g., from a `.env.local` value not overridden in production), the law firm receives no actual payment for any transaction that appears successful in the application.

**Why it happens:**
BPoint's test mode is a request-level flag, not a separate environment endpoint. It is easy to hardcode `IsTestTxn: true` during development and forget to gate it behind an environment variable. The Stripe equivalent (test vs. live API keys) makes this impossible — wrong key = wrong environment. BPoint's design allows production credentials + test mode flag to coexist.

**How to avoid:**
Never hardcode `IsTestTxn`. Gate it strictly on `NODE_ENV`:

```typescript
const payload = {
  // ...
  IsTestTxn: process.env.NODE_ENV !== "production",
};
```

Add a pre-deploy check (CI or lint rule) that rejects any file containing the string `IsTestTxn: true` as a literal (not a variable).

**Warning signs:**
- `IsTestTxn: true` appears as a literal in any non-test file
- No environment variable controlling test mode
- Transactions show `IsTestTxn: true` in BPoint backoffice under production merchant account

**Phase to address:** Phase 3 — Go-live / production hardening

**Impact if missed:** Law firm processes all client payments but receives zero funds. Discovered only at bank reconciliation — potentially days or weeks later. Every "paid" matter since launch is unrecovered revenue.

---

### Pitfall 8: lineItem Description Drift Breaks Smokeball Invoice Reconciliation

**What goes wrong:**
The Zapier automation that syncs payment data to Smokeball CRM reads specific fields from the transcript email — including the `lineItem` description string (e.g., "Legal consultation — Urgent matter"). If the BPoint integration changes the label, format, or field name used in receipts or transcript emails, Zapier's parsing fails silently. Smokeball invoices stop being created or are created with wrong amounts. The firm's bookkeeper discovers the mismatch at end of month.

**Why it happens:**
During the Stripe-to-BPoint swap, developers focus on the payment mechanics and assume the downstream email/Zapier pipeline is unchanged. They update email templates to remove Stripe references without realising the exact string content is what Zapier's parser matches on. BPoint receipts may use different default field labels.

**How to avoid:**
Treat `lineItem` as a contract, not a label. Define it as a constant and use it everywhere — in the BPoint AuthKey `MerchantReference` field, in the email template, and in the Zapier field mapping:

```typescript
const LINE_ITEMS = {
  urgent:    "Legal consultation — Urgent matter",
  nonUrgent: "Legal consultation — Non-urgent matter",
} as const;
```

After swapping to BPoint, manually run the full Zapier zap end-to-end in staging and confirm a Smokeball invoice is created with the correct line item description and amount before going live.

**Warning signs:**
- Email template was edited during BPoint migration without a Zapier test run
- `lineItem` string defined in multiple places (drift risk)
- No staging test of the full Zapier → Smokeball flow after the swap

**Phase to address:** Phase 2 — Webhook handler and downstream pipeline integration

**Impact if missed:** Silent Smokeball invoice corruption. Discovered at reconciliation. Manual remediation of every affected matter. Potential compliance issue for a law firm with trust accounting obligations.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Using redirect URL params as payment proof | Faster checkout flow, no server round-trip | Forgeable; anyone can trigger receipt email | Never |
| Hardcoding `IsTestTxn: true` | Easy local testing | Silently captures no funds in production | Never in shared/deployed code |
| Storing pricing as dollar amounts, converting to cents at call site | Human-readable constants | Conversion bugs; 100x undercharge risk | Never for payment amounts |
| Skipping `Approved` field check | Simpler success logic | Declined cards treated as successful | Never |
| Single-use CSP exception (`frame-src *`) | Unblocks development quickly | Violates PCI SAQ-A iframe isolation requirements | Never in production |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| BPoint Auth Header | `btoa(username + ':' + password)` standard Basic Auth | `btoa(username + '|' + merchantNumber + ':' + password)` — pipe separator is mandatory |
| BPoint iframe embed | Using `src` pointing to the raw BPoint URL without first creating an AuthKey | Create AuthKey server-side first; embed `https://www.bpoint.com.au/webapi/v2/txns/iframe/{authKey}` |
| BPoint webhook | Returning HTTP 200 after timeout causes BPoint to believe success, returning 4xx causes retries | Return 200 immediately, process async — or ensure sub-2s response time |
| Zapier → Smokeball | Changing transcript email field names or structure | Freeze the email field schema as a typed contract; test Zapier after any email template change |
| Upstash Redis deduplication | Setting the dedup key AFTER side effects | Set dedup key BEFORE sending emails or creating tokens to prevent race on concurrent retries |
| BPoint UAT environment | Using production endpoint during development | Use `https://bpoint.uat.linkly.com.au` for all non-production testing; separate credentials required |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Synchronous BPoint verification in webhook handler | Webhook times out; BPoint retries; duplicate side effects | Respond 200 immediately, use async queue or Redis job for verification | Any slow external API call in handler |
| Blocking AuthKey creation on chat message | User sees payment card after perceptible delay | Create AuthKey speculatively on tier confirmation, before user clicks "Pay now" | High server load, cold starts on Vercel |
| Search Transactions API call on every page load (polling) | BPoint rate limits; slow payment confirmation UX | Use webhook as primary signal; poll only as fallback after 30s timeout | Any repeated polling pattern |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Logging BPoint auth credentials in Next.js API routes | Credentials exposed in Vercel log drain | Ensure `Authorization` header is never logged; use structured logging with field redaction |
| Exposing `MerchantNumber` to client-side code | Enables fraudulent AuthKey creation attempts | All BPoint API calls must be server-side only; merchant credentials never in browser bundle |
| Not validating webhook origin | Any server can POST to your webhook and trigger downstream actions | BPoint webhooks do not use HMAC signatures — validate by doing a server-side transaction lookup on every webhook rather than trusting the payload |
| Using `frame-src *` in CSP to unblock BPoint iframe | Violates PCI SAQ-A; allows any domain to load in iframe context | Allowlist only `https://www.bpoint.com.au` and UAT equivalent |
| Storing card data in session (Redis) | PCI scope expansion | Never store card numbers, CVV, or full PANs; BPoint's iframe handles card capture — your code only handles the `ResultKey` / `TxnNumber` |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No expiry warning on BPoint AuthKey session | Client fills form, submits, gets cryptic error because session expired | Show a 25-minute countdown timer; auto-create a new AuthKey if user is still on page at expiry |
| Generic "Payment failed" message on bank decline | Client doesn't know whether to retry, use a different card, or call their bank | Map BPoint bank response codes to human-readable messages: "Card declined — please try a different card or contact your bank" |
| Redirecting parent window from within BPoint iframe | Client loses chat context; back button takes them to BPoint, not the chat | Handle `RedirectionUrl` as an internal route; use the ResultKey server-side and update the chat UI state without full page reload |
| No loading state between "Pay now" click and iframe render | Client double-clicks; two AuthKey sessions created | Disable "Pay now" button after first click; show spinner until iframe src is set |

---

## "Looks Done But Isn't" Checklist

- [ ] **Payment confirmation:** Redirect URL params are not used as proof — server-side `ResultKey` lookup confirms `ResponseCode === "0"` AND `Approved === true`
- [ ] **Auth header:** Decoded value contains a pipe character between username and merchant number (not just colon-separated)
- [ ] **Amount encoding:** Value passed to BPoint is an integer (no decimal point); `132000` for $1,320 AUD
- [ ] **Deduplication:** `TxnNumber` checked in Redis before any email send, token creation, or Zapier trigger
- [ ] **Test mode:** `IsTestTxn` is `false` (or absent) in all production-bound payloads; controlled by `NODE_ENV` not a hardcoded literal
- [ ] **CSP headers:** `frame-src` and `connect-src` include `https://www.bpoint.com.au` in production Next.js config
- [ ] **lineItem contract:** Exact string values sent in BPoint `MerchantReference`, email template, and Zapier field map are verified to match after BPoint migration
- [ ] **Webhook idempotency:** Full end-to-end test with BPoint retry simulation (send same webhook payload twice) confirms only one email sent and one token created
- [ ] **Bank decline handling:** Test card with a decline response code (e.g., expiry `99/51` for decline code 51) confirms client sees a useful error message, not an unhandled exception
- [ ] **Zapier smoke test:** Post-BPoint migration, a full test payment in staging confirms a Smokeball invoice is created with the correct description and amount

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Test mode left on in production | HIGH | Identify all affected transactions in BPoint backoffice (IsTestTxn flag); contact clients for re-payment; no automated recovery |
| Duplicate emails sent | MEDIUM | Identify duplicate `TxnNumber` events in logs; send apology email to affected clients; add dedup before next deploy |
| Wrong amount charged (dollar vs cents) | HIGH | BPoint does not support self-serve refunds via API for law firm accounts; requires BPoint support ticket; client must be recharged correctly; Smokeball invoice manual correction |
| Smokeball lineItem drift | MEDIUM | Identify affected matters via Smokeball invoice audit; correct via Smokeball API or manual entry; fix Zapier parser and redeploy email template |
| Forged redirect exploit | CRITICAL | Rotate BPoint credentials immediately; audit all transactions in BPoint backoffice vs Redis session store to find unmatched "paid" sessions; engage law firm compliance team |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Redirect URL as payment proof | Phase 1: BPoint session endpoint | Integration test: assert `ResultKey` lookup is called before any session mutation |
| Malformed auth header | Phase 1: API client setup | Unit test: decode the base64 env var and assert it contains `\|` |
| Amount in dollars not cents | Phase 1: AuthKey creation | Unit test: assert `PRICING.urgent.amountCents === 132000` (integer) |
| No webhook deduplication | Phase 2: Webhook handler | Integration test: POST same webhook payload twice; assert single email in Resend logs |
| ResponseCode only, not Approved | Phase 2: Payment verification | Unit test: mock txn with `ResponseCode:"0", Approved:false`; assert function returns false |
| CSP blocks iframe | Phase 1: PaymentCard component | Manual: load payment page in browser, check console for CSP violations |
| TestMode in production | Phase 3: Pre-launch hardening | CI check: grep codebase for literal `IsTestTxn: true` and fail build if found |
| lineItem drift | Phase 2: Email template + Zapier | End-to-end: test payment in staging triggers correct Smokeball invoice |

---

## Sources

- BPoint Developer Reference v2: https://www.bpoint.com.au/developers/v2/
- BPoint Developer Reference v5: https://www.bpoint.com.au/developers/v5/api
- BPoint v5 Iframe Fields: https://www.bpoint.com.au/developers/v5/api/txn/authkey/payment-method/iframe-fields
- BPoint v5 Test Mode: https://www.bpoint.com.au/developers/v5/reference/test-mode
- BPoint UAT environment: https://bpoint.uat.linkly.com.au/developers/v2/
- BPoint Bank Response Codes: https://www.bpoint.com.au/developers/v5/reference/bank-response-codes
- BPoint v3 Transaction Response Description: https://bpoint.com.au/developers/v3/partialViews/Sections/txnresponses/description.html
- omnipay-bpoint Response.php (dual-check pattern): https://github.com/wakeless-net/omnipay-bpoint/blob/master/src/Message/Response.php
- Spreedly BPoint Gateway Guide: https://docs.spreedly.com/payment-gateways/bpoint/
- PCI DSS iframe scope (SAQ-A eligibility): https://www.pci-proxy.com/blog-posts/iframes-an-saq-a-eligible-way-to-collect-credit-card-details
- PCI DSS 4.0 iframe security requirements: https://www.feroot.com/blog/iframe-payment-security-pci-dss-643/

---
*Pitfalls research for: BPoint payment gateway integration, Next.js chat, Australian law firm*
*Researched: 2026-04-23*
