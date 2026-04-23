# Urgent SMS Notification & BPoint Payment — Design

**Date:** 2026-04-22
**Status:** Draft, awaiting user review
**Client:** Aquarius Lawyers (Australian law firm)

## Context

Two requirements landed from the client that must be addressed before they sign off on the chatbot proposal:

1. **Urgent SMS notification.** When a visitor reports an urgent matter, the firm wants an SMS sent to the duty solicitor (`+61 450 533 474`) so they can phone the visitor back. The visitor should see a confirmation: *"A SMS has been sent to your solicitor — they will be in touch shortly."*
2. **BPoint payment integration.** Replace Stripe with BPoint (Commonwealth Bank) for payments. Stripe takes ~3 days to settle to the firm's account; BPoint settles next business day to a CBA account, which is required for the firm's Trust Accounting workflow.

Both features are independent and can ship separately. SMS first (low risk, ~1 day), BPoint second (multi-day, blocked on credentials from Aquarius / their CBA merchant manager).

## Decisions Captured

| Decision | Choice | Reason |
|---|---|---|
| When SMS fires | Auto-fire on entry to urgent contact card; phone number stays visible | Defence-in-depth — SMS is the new alert, phone is the safety net |
| SMS body | Name, phone, email, urgency tag, short session id | Solicitor needs enough to call back without checking another system |
| SMS provider | ClickSend | Australian, REST-only, low setup, ~$0.077/SMS |
| SMS failure UI | Show *"Couldn't text, please call"* fallback | For urgent matters, accuracy beats reassurance |
| SMS + email | Existing inquiry/booking emails to firm + client unchanged; SMS is additive for urgent only | Don't double-build what `sendClientInquiryEmail` already does |
| Stripe vs BPoint | Replace Stripe entirely | Trust accounting is the stated reason; splitting payment paths adds maintenance for no visitor benefit |
| BPoint integration mode | Iframe Fields (hosted card fields embedded in our chat-styled form) | Closest match to current Stripe Embedded UX while keeping PCI scope at SAQ-A |
| Payment confirmation | Synchronous AJAX → server-to-server `SearchTransactions` re-verify | BPoint has no webhook system; verifying server-side prevents spoofed success |
| Stripe code disposition | Delete after 1 week of clean BPoint production usage | Don't keep dead payment paths |

## Feature 1 — Urgent SMS Notification

### Architecture

```
Visitor reports urgent matter
        ↓
collectDetails → uploadDocuments → showUrgentContact tool fires
        ↓
UrgentContactCard mounts
        ↓
On mount → POST /api/notify-solicitor { sessionId }
        ↓
Server: load intake from Redis → build SMS body → POST ClickSend /v3/sms/send
        ↓
On success → mark intake.smsNotifiedAt → return { ok: true }
On failure → return { ok: false }
        ↓
Card shows "SMS sent" or "Couldn't text, please call" + phone number
```

### New Files

**`src/lib/clicksend.ts`** — thin REST wrapper.

- `sendSms({ to, body }): Promise<{ ok: boolean; messageId?: string; error?: string }>`
- Basic-auth via `CLICKSEND_USERNAME` + `CLICKSEND_API_KEY`
- Sender ID via `CLICKSEND_SENDER_ID`
- No retry; caller decides

**`src/app/api/notify-solicitor/route.ts`** — POST `{ sessionId }`.

- Loads intake from Redis (`getIntake`)
- 404 if intake missing or `urgency !== "urgent"`
- 200 `{ ok: true, alreadySent: true }` if `intake.smsNotifiedAt` exists (idempotent)
- Builds body, sends via ClickSend
- On success, calls `updateIntake(sessionId, { smsNotifiedAt: now })`
- Returns `{ ok: true | false }`

### Modified Files

**`src/lib/tools/show-urgent-contact.ts`**
- No schema change required (the SMS state is owned by the card component, not the tool).

**`src/components/booking/urgent-contact-card.tsx`**
- Add `useEffect` on mount to POST `/api/notify-solicitor`
- Local state machine: `sending | sent | failed`
- Render above the existing phone block:
  - `sending`: spinner + "Notifying your solicitor by SMS…"
  - `sent`: green check + "A SMS has been sent to your solicitor — they will be in touch shortly."
  - `failed`: amber + "We couldn't text your solicitor automatically. Please call the number below."
- Phone number block stays visible in all three states.

**`src/lib/intake.ts`**
- Add `smsNotifiedAt: string | null` to `IntakeRecord`.
- Default to `null` in `createIntake`.

### SMS Body Format

```
URGENT — Aquarius chatbot intake. Client: <name> (<phone>, <email>). Session <id-short>.
```

- `<id-short>` = first 8 chars of `sessionId` (enough for support to look up).
- Total length must stay ≤160 chars to avoid multi-segment cost. Truncate name/email if needed.

### Environment Variables

| Var | Purpose |
|---|---|
| `CLICKSEND_USERNAME` | ClickSend account username |
| `CLICKSEND_API_KEY` | ClickSend API key |
| `CLICKSEND_SENDER_ID` | AU-registered alpha sender or `AQUARIUS` |
| `URGENT_SMS_RECIPIENT` | Default `+61450533474`; env-overridable for testing |

### Failure Handling

- ClickSend non-2xx → `{ ok: false }`, error logged to `console.error`. No retry.
- Existing inquiry email path unaffected — solicitor still gets the email regardless.
- Visitor sees the fallback UI; phone number is visible.

### Idempotency

- `intake.smsNotifiedAt` is the source of truth. Refresh = re-mount = re-POST = early return `{ ok: true, alreadySent: true }`.

### Testing

- Manual: dev with ClickSend test mode (no real send), verify body, idempotency, failure UI by breaking the API key.
- One real end-to-end SMS to `+61450533474` in staging before launch (coordinate with the firm).
- No unit tests for the ClickSend wrapper — thin, integration-tested via the route.

## Feature 2 — BPoint Payment

### Architecture

```
Visitor completes intake → BookingPayment component renders
        ↓
On mount → POST /api/checkout { sessionId, urgency }
        ↓
Server: createAuthKey via BPoint AddAuthKey API → return { authKey, iframeUrl }
        ↓
Client: load BPoint iframe-fields JS → mount transparent iframes for PAN/expiry/CVV
        ↓
Visitor clicks "Pay $X" → BPoint JS submit() → success callback fires with receiptNumber
        ↓
Client: POST /api/checkout/confirm { sessionId, authKey, receiptNumber }
        ↓
Server: verifyTransaction via BPoint SearchTransactions API
        ↓
If settled: updateIntake({ paidAt, bpointReceiptNumber, amountPaid })
            → trigger existing sendBookingNotificationEmail + sendPaymentReceipt
            → return { ok: true, paid: true }
If not:     return { ok: false }; client shows error, stays on payment step
```

### New Files

**`src/lib/bpoint.ts`** — mirror of `src/lib/stripe.ts`.

- `PRICING` constant (moved from `stripe.ts` unchanged):
  - `urgent`: $1,320.00 / "Initial Deposit for Urgent Court Matter"
  - `non-urgent`: $726.00 / "Legal Strategy Session"
- `createAuthKey({ sessionId, urgency, customerEmail })` → POST to BPoint `AddAuthKey`, returns `{ authKey, iframeUrl, expiresAt }`.
- `processIframePayment(authKey)` → invoked server-side after browser submits iframe.
- `verifyTransaction(receiptNumber)` → calls BPoint `SearchTransactions`, returns `{ settled: boolean, amountCents: number, receiptNumber: string }`.
- All BPoint API calls server-side only. Credentials never touch the browser.

**`src/app/api/checkout/confirm/route.ts`** — POST `{ sessionId, authKey, receiptNumber }`.

- Loads intake; 404 if missing.
- Calls `verifyTransaction(receiptNumber)` — required, never trust browser-supplied success.
- On settled + amount-matches: `updateIntake({ paidAt, bpointReceiptNumber, amountPaid })`, fires existing booking notification + payment receipt emails, returns `{ ok: true, paid: true }`.
- On mismatch or unsettled: returns `{ ok: false }`; intake unchanged.

**`src/components/booking/bpoint-iframe-fields.tsx`** — replaces the embedded Stripe Checkout component.

- Renders own card-form layout (label + iframe target div for PAN, expiry, CVV).
- Loads BPoint JS via `<Script>` from BPoint's CDN URL.
- Mounts iframes against the targets after script loads.
- "Pay $X.XX" button calls BPoint JS `submit()`.
- Success callback → POST `/api/checkout/confirm` → on `{ ok:true, paid:true }` advances chat to the same success state Stripe currently triggers.
- Error callback → inline error under the form, button re-enables.

### Modified Files

**`src/app/api/checkout/route.ts`**
- Replace `createCheckoutSession` (Stripe) call with `createAuthKey` (BPoint).
- Persist `bpointAuthKey` to intake instead of `stripeSessionId`.
- Return `{ authKey, iframeUrl }` instead of `{ clientSecret }`.

**`src/lib/intake.ts`**
- Replace `stripeSessionId: string | null` with `bpointAuthKey: string | null` and `bpointReceiptNumber: string | null`.
- Add `paidAt: string | null` and `amountPaid: number | null`.

**Wherever Stripe Embedded Checkout currently mounts** — verify in implementation; replace with `BpointIframeFields`.

### Removed Files (after 1-week soak)

- `src/lib/stripe.ts`
- `src/app/api/webhooks/stripe/...` (verify exact path during implementation)
- Stripe env vars in Vercel: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `stripe` package from `package.json`

### Environment Variables

| Var | Purpose |
|---|---|
| `BPOINT_API_USERNAME` | API user from BPoint Back Office → User Management |
| `BPOINT_API_PASSWORD` | API user password |
| `BPOINT_MERCHANT_NUMBER` | Aquarius's BPoint merchant number |
| `BPOINT_BILLER_CODE` | Biller code allocated by CBA |
| `BPOINT_BASE_URL` | UAT vs prod (`https://www.bpoint.uat.linkly.com.au` vs `https://www.bpoint.com.au`) |
| `PAYMENT_PROVIDER` | `stripe` or `bpoint` — toggle for staged rollout |

### Security

- Server-side `verifyTransaction` is non-optional on the confirm route. Browser-supplied `receiptNumber` is treated as untrusted until BPoint confirms.
- `authKey` is single-use, expires per BPoint default (~30 minutes).
- BPoint credentials server-side only.
- All BPoint endpoints HTTPS (already required for iframe embedding).

### Open Dependencies on Aquarius

These block the start of BPoint dev:

1. UAT BPoint API credentials (username, password, merchant number, biller code).
2. Confirmation that their CBA merchant agreement includes Iframe Fields entitlement (not BPoint Lite).
3. Production credentials before launch.
4. A bookkeeper available for a $1 production smoke-test transaction + immediate refund.

### Testing

- All dev/QA against BPoint UAT using their published test cards.
- Manual matrix: success, declined, expired, browser closed mid-payment, receipt-number tampering attempt.
- One $1 production smoke test, refunded immediately.

## Rollout Plan

1. **Ship SMS feature** behind no flag. Small surface, safe to deploy on its own. Verify with one real send in staging.
2. **Ship BPoint** behind `PAYMENT_PROVIDER=stripe|bpoint` env toggle, default `stripe`. Run UAT.
3. Flip production to `PAYMENT_PROVIDER=bpoint`.
4. **After 1 week of clean BPoint usage:** delete Stripe code/config, remove toggle, remove Stripe env vars and package.

## Edge Cases

| Case | Behaviour |
|---|---|
| Visitor refreshes after SMS sent | `smsNotifiedAt` flag prevents re-send; UI re-reads intake and shows success state |
| Visitor refreshes mid-payment | AuthKey expires (~30 min); intake unpaid; restart checkout fetches fresh AuthKey |
| BPoint API outage | `/api/checkout` returns 503; visitor sees "Payment system temporarily unavailable, please try again shortly." No Stripe fallback. |
| Trust-accounting reconciliation | BPoint receipt number on intake flows through booking notification email; bookkeeper matches deposits to matters by receipt number |
| ClickSend outage | Visitor sees "Couldn't text, please call" fallback; existing inquiry email still reaches solicitor |
| Receipt-number tampering | Server-side `verifyTransaction` rejects mismatched amount or unsettled status; intake stays unpaid |

## Out of Scope (Deliberately Deferred)

- Apple Pay / Google Pay (not supported by BPoint Iframe Fields).
- Stored card / repeat payments (not needed for one-off intakes).
- Refund automation (firm uses BPoint Back Office).
- SMS to client (only the solicitor gets SMS; client gets the existing email).
- Multi-segment SMS support (we cap at 160 chars and truncate fields if needed).

## Open Questions

None at design time. Implementation may surface questions about:
- Exact location of the current Stripe-embed component (verify by grep before refactor).
- Exact Stripe webhook path to delete (verify during cleanup phase).
- BPoint UAT vs production hostname differences for iframe-fields JS asset URL.

---

## Addendum — 2026-04-23 client-credentials setup

Reviewed + updated after the client-credentials meeting with Julie
Bargenquast. Captures architectural decisions made while wiring the live
integrations that weren't in the original design. Live handover status is
tracked in [`docs/2026-04-23-integration-status.md`](../../2026-04-23-integration-status.md).

### New decisions

| Decision | Choice | Reason |
|---|---|---|
| Dev vs prod Zap isolation | Separate Zap IDs per environment | Smokeball has no sandbox — test pollution is unrecoverable without manual matter deletion. Dev code hits email-only Zap #4; prod code hits Smokeball Zap #1. |
| Test-payload guard flag | Top-level `isTest: boolean` in webhook body | Nested `meta.testPayload` silently failed to bind in Zapier's Filter-step field picker; top-level flat keys bind reliably. |
| Prod Zap filter behaviour | Filter: "Only continue if `isTest` is false OR does not exist" | Both belt + braces — env-var error and guard flag must both fail before a test payload reaches Smokeball. |
| Session → Smokeball matter mapping | Capture-back via Zap #1 tail webhook, not custom Smokeball field | Avoids Julie-side admin work, keeps matter IDs as Smokeball's own UUIDs, and the mapping becomes reusable (e.g., lawyer admin view, client "your matter" link). |
| Capture-back auth | `X-Smokeball-Capture-Secret` shared-secret header | Simpler than HMAC while still preventing spoofed matter IDs. Secret stored in Vercel env + Zapier action config. |
| BPoint env strategy | Prod facility only; dev uses BPoint sandbox endpoint with same SCI creds | Aquarius has no separate UAT facility. Pre-launch smoke test will be a real $0.01 txn + refund on prod. |
| Calendly webhook creation | Programmatic via Personal Access Token + `POST /webhook_subscriptions` | Calendly's UI doesn't expose the signing key we supply — only the POST API does. Signing key is generated client-side (`openssl rand -hex 32`) and passed into the subscription request. |
| ClickSend sender ID | Start with shared numeric, swap to alpha `AquariusLaw` once ClickSend approves | Alpha approval is 1–2 business days; don't block Monday demo. |

### New architecture fragment — session → matter capture-back

```
1. Visitor pays via BPoint
       ↓
2. /api/checkout/confirm → createIntake → POST to ZAPIER_WEBHOOK_URL
       ↓
3. Zap #1 — Filter(isTest) → Smokeball Create Matter
       ↓
4. Zap #1 tail — Webhooks by Zapier POST to
   /api/webhooks/smokeball-matter-created with
   { sessionId, smokeballMatterId } + X-Smokeball-Capture-Secret header
       ↓
5. Our endpoint verifies the secret, writes
   `session:${sessionId}:matterId → smokeballMatterId` to Redis (TTL 90d)
       ↓
6. Later: client uploads late doc → handleUploadCompleted reads
   Redis → includes smokeballMatterId as matter_ref in Zap #2 payload
       ↓
7. Zap #2 — Filter(isTest) → Smokeball Upload File to Matter
```

### New env vars (added to `.env.example`)

```
BPOINT_API_USERNAME=           # SCI-only user created in BPoint Back Office
BPOINT_API_PASSWORD=
BPOINT_MERCHANT_NUMBER=
BPOINT_BILLER_CODE=
BPOINT_ENV=sandbox             # "sandbox" | "prod"

CLICKSEND_USERNAME=
CLICKSEND_API_KEY=
CLICKSEND_SENDER_ID=           # blank = shared number; "AquariusLaw" once approved
URGENT_SMS_RECIPIENT=          # E.164 solicitor mobile

CALENDLY_PERSONAL_ACCESS_TOKEN=
CALENDLY_WEBHOOK_SIGNING_KEY=  # we generate + supply on subscription create

ZAPIER_DEV_WEBHOOK_URL=        # dev-only Zap #4 (email, never Smokeball)
SMOKEBALL_CAPTURE_SECRET=      # shared secret for capture-back endpoint auth
```

### New files to build (weekend)

- `src/app/api/webhooks/smokeball-matter-created/route.ts` — capture-back endpoint
- `src/lib/session-matter-map.ts` — Redis read/write helper (`setMatterIdForSession`, `getMatterIdForSession`)
- Updates to `src/lib/late-upload/handle-completed.ts` — resolve `matterRef` from Redis by sessionId rather than accepting as function arg

### Rollout order (Monday demo path)

1. **Weekend (agency)** — build endpoint + helper + update late-upload, deploy to `aquarius-chatbot.vercel.app`.
2. **Sunday** — set `SMOKEBALL_CAPTURE_SECRET` in Vercel prod env vars.
3. **Sunday** — wire the Zap #1 tail webhook step (URL + header + JSON body), test end-to-end with a real-shaped payload, confirm Redis write.
4. **Sunday** — configure Zap #2 Matter ID dynamic mapping, add filter, publish.
5. **Monday** — demo flow: intake → BPoint pay (mocked if Iframe Fields still pending) → Smokeball matter appears → optional late-upload demo.

### Known weekend unknowns

- **Does Smokeball's Zapier "Create Matter" action return the new matter UUID as a field that can be mapped in the tail step?** High confidence yes (Zapier standard pattern) but verify by inspecting step 3's output schema during testing.
- **Does Smokeball's Zapier "Upload File to Matter" accept a UUID directly in the Matter ID field when dynamic-mapped, or only via its dropdown search?** If only dropdown, we need a "Find Matter" preceding step even with capture-back. Will test Sunday.
