# Feature Research

**Domain:** Transactional SMS nudges — legal-intake document-upload flow (AU)
**Researched:** 2026-04-24
**Confidence:** HIGH (regulatory claims verified against ACMA official sources and ClickSend docs; scheduler claims MEDIUM due to QStash docs gap on App Router)

---

## Regulatory Foundation (Read Before Features)

Australia's Spam Act 2003 classifies any commercial electronic message — including SMS — into two tiers:

**Designated Commercial Electronic Messages (DCEMs)** — pure service/transactional messages containing *only* factual information directly related to a service the recipient already initiated. DCEMs do **not** require prior consent and do **not** require a functional unsubscribe facility. They *do* require accurate sender identification and contact details.

**Standard Commercial Electronic Messages (CEMs)** — everything else, including mixed-purpose messages that contain any promotional content. CEMs require prior consent + identification + functional unsubscribe.

**This milestone's SMS qualifies as a DCEM** — the client initiated the intake, paid, and the SMS contains only the upload link for that specific matter. No upsell, no promotional copy, no cross-sell. Provided copy stays purely factual, opt-out language is best practice but legally optional for DCEMs. Because ClickSend's alpha-tag sender IDs are one-way (no inbound SMS), a STOP keyword cannot be included in the message itself — the legally compliant alternative is including a phone number or email in the message that the client can contact to opt out.

**ACMA Sender ID Register (mandatory from 1 July 2026)** — all alphanumeric sender IDs (alpha tags) used to send to Australian numbers must be registered via a participating provider using the sender's ABN. Unregistered sender IDs will display as "Unverified" after that date. Registration opened 30 November 2025. This affects this milestone directly.

---

## Feature Landscape

### Table Stakes (Must Have — Missing = Broken)

| Feature | Why Expected / Required | Complexity | Notes |
|---------|------------------------|------------|-------|
| **E.164 phone normalisation** | ClickSend API requires `+61XXXXXXXXX` format. AU numbers from intake are stored without country code (validators.ts accepts local format). Sending a raw `04XXXXXXXX` will fail silently or reach the wrong number. | S | `validatePhone` in `src/lib/validators.ts` already accepts AU formats but does not output E.164. A small transform (`04XX…` → `+614XX…`) is the full scope. |
| **Landline detection and silent skip** | Sending SMS to a landline is a wasted segment charge and may cause ClickSend to flag the account. AU mobile numbers start with `04`. Landlines start with `02`–`03`, `07`, `08`. Detection is a prefix check. | S | Log the skip as a structured event (phone_type: landline, session_id) so upload-completion analysis can account for it. Do not throw — downstream flow must continue. |
| **Idempotency guard on send** | Stripe and Bpoint webhooks can deliver the same `payment_success` event more than once (at-least-once delivery). Without a guard, the client receives duplicate "payment confirmed" SMS. Use Redis with a TTL keyed on `session_id + sms_type` (e.g. `sms:sent:immediate:{sessionId}`). | S | TTL should exceed the provider retry window (72h is safe for Stripe). Already uses Upstash Redis — same client, same pattern as upload tokens. |
| **"Already uploaded" check before 24h reminder** | Core business requirement: do not charge for a segment or annoy a client who already uploaded. Check the upload-completion flag in Redis before dispatching the reminder. | S | The upload completion flag already exists in Redis (written by `handle-completed.ts`). Reminder logic reads it; if set, logs "skipped: already uploaded" and exits. |
| **Structured delivery logging** | Needed to measure whether SMS actually lifted upload-completion rates (the stated Core Value). Without logs, there is no way to know if ClickSend delivered, if the link was clicked, or if the reminder fired. Log: `sms_sent`, `sms_skipped` (reason), `sms_delivery_receipt` events with `session_id`, `sms_type` (`immediate`/`reminder`), `status`, `timestamp`. | S | ClickSend delivery receipts require a webhook endpoint or polling. Webhook is strongly preferred (real-time). Uses the existing API route pattern. |
| **Graceful degradation when env vars absent** | App must boot and function on local dev and Vercel preview deployments where `CLICKSEND_USERNAME` / `CLICKSEND_API_KEY` are not set. SMS dispatch module returns early with a warning log; no error thrown; no impact on payment flow. | S | Same pattern as Resend in `src/lib/resend.ts` — check env at call-site, warn and return if absent. |
| **ACMA-compliant sender identification** | DCEMs still require accurate sender details in or accompanying the message. The firm name must appear in the message body or sender ID. Using a registered alpha tag (e.g. `AquariusLaw`) satisfies this if registered with ACMA before 1 July 2026. Using a shared long code is an interim fallback. | S | Alpha tag registration is the firm's responsibility via ClickSend's dashboard (ABN required). The code must be written to use whatever `FROM` value is in `CLICKSEND_SENDER_ID` env var. |
| **Rate-limit guard per session** | Prevent abuse where a replay attack or misconfigured webhook fires SMS repeatedly for the same session. Cap at 1 immediate + 1 reminder per session. Idempotency Redis keys (above) handle this automatically if keyed correctly. | S | Covered by idempotency guard if implemented correctly. Document explicitly so it is not accidentally removed. |

### Differentiators (Worth Building — Not Expected)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **First-name personalisation in copy** | "Hi Sarah," reads as human attention, not a system message. Reduces the likelihood the client dismisses it as automated spam. First name is already captured in intake (`collect-details.ts`). | S | Name is in session/intake data in Redis. Retrieve it in the SMS dispatch function. Fallback: omit the greeting if name is absent (do not use "Hi there"). |
| **ClickSend `shorten_urls: true` with click-tracking** | Upload links contain session tokens and are long (likely 60–80+ chars). Shortening to `smsu.io/xxxxxx` keeps the message under 160 characters in a single segment, reducing cost and the chance of carrier truncation. ClickSend's tracking then shows whether the link was tapped — directly answering "did they open it?" | M | ClickSend requires URL vetting before shortening is enabled for a new account — there can be a small delay. Must be a single URL in the message body. Note from ClickSend docs: "ClickSend is pausing SMS messages containing URLs for new customers" — contact support to get approval for the upload URL domain before launch. |
| **QStash-scheduled 24h reminder (not Vercel Cron)** | A Vercel Cron job fires on a schedule (e.g. every hour) and must scan Redis for pending reminders — this is polling, adds Redis read cost, and has up to 59-minute jitter. QStash with `notBefore` (Unix timestamp = payment_time + 86400s) fires exactly once per session at the right time. No scan, no jitter, built-in deduplication. | M | QStash integrates with Upstash (already in stack). `verifySignatureAppRouter` wrapper handles auth in App Router. Message payload: `{ sessionId, type: "reminder" }`. Handler checks upload status before sending. Fallback: Vercel Cron every 30 min is acceptable if QStash adds deployment complexity. |
| **Delivery receipt webhook endpoint** | Real-time status per message. Without it, the only way to know a message failed is to poll the ClickSend API. With it, logs show `Delivered` / `Failed` / `Undelivered` within seconds, enabling the firm to chase up by phone if the SMS bounced. | M | Requires a new `POST /api/webhooks/clicksend/receipt` route. Verify ClickSend's HMAC signature (or shared secret) before processing. Follows the same pattern as `src/app/api/webhooks/stripe/route.ts`. |

### Anti-Features (Explicitly Do Not Build)

| Feature | Why Requested | Why Problematic | What to Do Instead |
|---------|---------------|-----------------|-------------------|
| **Escalating nudge ladder (3h, 24h, 48h, 72h)** | More touchpoints feel like higher completion probability | Harassment perception on a legal matter is damaging to the firm's brand. Clients may be in custody, in court, or dealing with crisis. Multiple SMS from a law firm they just paid reads as predatory. Regulated channel; ACMA enforcement is real. | Single 24h reminder only. Firm can follow up by phone if upload still missing after 24h — that is a human relationship matter, not an automation matter. |
| **Emoji-heavy or marketing-style copy** | Makes the message "pop" and feel engaging | Looks unprofessional for a law firm. Emojis increase character count (some are multi-byte, count as 2+ chars). Carriers can flag emoji-heavy messages. Legal clients in distress read urgency emojis as alarm rather than friendliness. | Plain professional prose. The firm's credibility is the differentiator, not emoji use. |
| **URL preview / rich SMS (MMS, RCS)** | Richer experience, image of firm logo | MMS is more expensive per message, not universally supported on AU networks, and adds implementation complexity (media hosting, content-type handling). RCS has patchy carrier support. Neither is necessary for a text link. | Plain SMS with a shortened HTTPS link. |
| **Two-way SMS inbox / STOP keyword interception** | Gives the firm visibility into who opted out | Building an inbound SMS processing pipeline is a separate feature with its own consent, storage, and compliance requirements. ClickSend handles STOP opt-outs natively at account level. Intercepting and re-processing them adds surface area with no benefit. | Delegate entirely to ClickSend's built-in opt-out list. Out of scope per PROJECT.md. |
| **Firm new-lead SMS alert** | Firm gets notified faster than email | Firm already receives email. Adding SMS for staff changes the consent and sender-ID story on the firm's own staff numbers. Adds scope with no upload-completion impact. | Firm-side notification is already handled by Resend email. Defer separately. |
| **SMS confirmation on upload completed** | Nice closing loop for the client | Adds another ClickSend call with its own idempotency, landline-skip, and logging concerns. The email confirmation already handles this. Adding SMS confirmation risks the message being perceived as excessive contact. | Email already sent on upload completion. No SMS needed for that event. |
| **Custom opt-out keyword in message body (STOP)** | Seems like good practice | Alpha-tag sender IDs do not support inbound replies — the STOP keyword cannot be honoured because there is no inbound channel. Including "reply STOP" in the message when STOP cannot be received is misleading and potentially non-compliant. | If an opt-out mechanism beyond the DCEM exemption is desired, include the firm's phone number or email in the message body so the client can contact them to opt out. ClickSend's account-level opt-out list handles it if a dedicated number (not alpha tag) is used. |
| **Personalised dynamic content beyond name + link** | "Your matter: Criminal — Assault, Court date: Thu 29 May" | Matter details in SMS are a privacy risk (messages are not encrypted, sit in carrier logs, viewable on lock screen). Legal matter details exposed in plaintext SMS is an ethical and potential privilege issue. | SMS body contains only first name, firm name, and the upload link. Matter detail stays in the secure upload portal. |

---

## Feature Dependencies

```
E.164 normalisation
    └──required by──> Immediate SMS send
    └──required by──> 24h Reminder SMS send

Idempotency guard (Redis key per session+type)
    └──required by──> Immediate SMS send
    └──required by──> 24h Reminder SMS send

"Already uploaded" check
    └──required by──> 24h Reminder SMS send
    └──depends on──> Upload completion flag in Redis (already exists)

Landline detection
    └──required by──> Immediate SMS send (skip before API call)
    └──required by──> 24h Reminder SMS send (skip before API call)

internal `intake-paid` event abstraction
    └──required by──> Immediate SMS send (decouples from Stripe/Bpoint)
    └──required by──> QStash scheduler enqueue

QStash scheduled job
    └──required by──> 24h Reminder SMS send
    └──requires──> internal `intake-paid` event (to know when to schedule)
    └──requires──> App Router QStash receiver endpoint

Delivery receipt webhook endpoint
    └──enhances──> Structured delivery logging
    └──requires──> ClickSend webhook URL configuration (dashboard)

ClickSend `shorten_urls`
    └──enhances──> Immediate SMS send + 24h Reminder SMS send
    └──requires──> URL pre-approval by ClickSend support (per domain)

First-name personalisation
    └──enhances──> Immediate SMS send + 24h Reminder SMS send
    └──requires──> Name in Redis session (already exists)
```

### Dependency Notes

- **E.164 normalisation is a hard prerequisite**: Without it, ClickSend will reject or misroute AU numbers. Must be done in the SMS dispatch function before any API call.
- **Idempotency depends on Redis being available**: If Upstash is down, the guard fails open — log a warning but do not block the payment flow. A failed SMS is less bad than a failed payment acknowledgement.
- **QStash receiver depends on the internal event abstraction**: If SMS is coupled directly to Stripe's webhook handler, the Bpoint migration (parallel worktree) will duplicate the dispatch logic. Abstract to a `dispatchPostPaymentSMS(sessionId)` function called from both payment handlers.
- **Delivery receipt webhook and idempotency are independent**: Receipts enhance observability but are not required for correct send behaviour. Can be added in a follow-up.
- **`shorten_urls` has an external dependency**: ClickSend URL approval. Build the send without it first, add it once approved. Use a feature flag (`CLICKSEND_SHORTEN_URLS=true` env var) to toggle.

---

## SMS Copy Examples

These are for a criminal law firm context. Professional, direct, not pushy. All under 160 characters (verified by char count). AU English.

### Immediate (post-payment)

```
Aquarius Lawyers: Hi [Name], payment received. Please upload your documents here: [link]
Questions? Call us: 02 XXXX XXXX
```
Character count without name/link: ~91 chars. With a 20-char name and 26-char shortened URL (`smsu.io/xxxxxx`): ~137 chars. Within one segment.

### 24h Reminder (if not uploaded)

```
Aquarius Lawyers: Hi [Name], we're still awaiting your documents to progress your matter. Upload here: [link]
```
Character count without name/link: ~96 chars. With name and shortened URL: ~142 chars. Within one segment.

### Fallback (if name unavailable)

```
Aquarius Lawyers: Payment received. Please upload your documents here: [link] Questions? Call 02 XXXX XXXX
```

**Copy principles applied:**
- Firm name leads (sender identification for DCEM compliance)
- Action is the first ask — no preamble about "we hope you're doing well"
- Link follows the ask — not buried
- Phone number satisfies identification requirement without "reply STOP" (incompatible with alpha tags)
- No urgency language ("urgent", "immediately", "action required") — inappropriate for a legal/distress context
- No emojis
- No reference to matter details (privacy)

---

## MVP Definition

### Launch With (v1 — this milestone)

- [x] E.164 normalisation — hard prerequisite
- [x] Landline detection and silent skip — avoids wasted sends and account flags
- [x] Idempotency guard (Redis) — prevents duplicate sends on webhook retry
- [x] Immediate SMS on payment success via `intake-paid` event abstraction
- [x] 24h reminder with "already uploaded" gate (scheduler TBD: QStash or Vercel Cron)
- [x] Structured logging (sms_sent, sms_skipped, structured fields)
- [x] Graceful degradation when env vars absent
- [x] First-name personalisation (S complexity, already in Redis)
- [x] ACMA sender identification via firm name in message body

### Add After Validation (v1.x)

- [ ] Delivery receipt webhook endpoint — add once v1 is live and basic send/skip rates are visible
- [ ] `shorten_urls` click tracking — add after ClickSend URL approval is obtained; blocked on external process, not code

### Future Consideration (v2+)

- [ ] Booking reminder SMS (Calendly trigger) — separate consent story, separate scope
- [ ] Firm new-lead SMS alert — separate sender ID, separate consent, separate scope
- [ ] Upload-completion SMS confirmation — assess whether email is sufficient after v1 data

---

## Feature Prioritisation Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| E.164 normalisation | HIGH (correctness) | LOW (S) | P1 |
| Landline skip | HIGH (cost + compliance) | LOW (S) | P1 |
| Idempotency guard | HIGH (correctness) | LOW (S) | P1 |
| Immediate SMS send | HIGH (core value) | LOW (S) | P1 |
| 24h reminder with upload check | HIGH (core value) | MEDIUM (M) | P1 |
| Graceful degradation | HIGH (dev ergonomics) | LOW (S) | P1 |
| Structured logging | HIGH (observability) | LOW (S) | P1 |
| First-name personalisation | MEDIUM (trust) | LOW (S) | P1 |
| ACMA sender identification | HIGH (compliance) | LOW (S — env var) | P1 |
| QStash scheduler (vs Vercel Cron) | MEDIUM (precision) | MEDIUM (M) | P2 |
| Delivery receipt webhook | MEDIUM (observability) | MEDIUM (M) | P2 |
| `shorten_urls` click tracking | MEDIUM (insight) | MEDIUM (M, external dep) | P2 |

---

## Compliance Summary

| Requirement | Source | Status for this Milestone |
|-------------|--------|--------------------------|
| Consent for SMS | Spam Act 2003 s.16 | Implied consent — client initiated intake and paid. DCEM exemption likely applies. | 
| Sender identification | Spam Act 2003 s.17 | Firm name in message body + alpha tag. Compliant. |
| Unsubscribe facility | Spam Act 2003 s.18 | Not required for DCEM. Phone number in body provides informal opt-out path. |
| Alpha tag registration | ACMA Sender ID Register (mandatory 1 Jul 2026) | Firm must register alpha tag via ClickSend before 1 July 2026. Code uses `CLICKSEND_SENDER_ID` env var — no code change needed when registration is complete. |
| No STOP reply on alpha tag | ACMA / ClickSend platform constraint | Do not include "reply STOP" in copy — alpha tags are one-way. Correct approach: firm phone number in body. |
| Landline exclusion | ClickSend platform + cost | Implemented as prefix check before API call. |

---

## Sources

- [ACMA — Avoid sending spam](https://www.acma.gov.au/avoid-sending-spam) — official Spam Act guidance, consent/identification/unsubscribe rules
- [ACMA Email and SMS Unsubscribe Rules (PDF, May 2024)](https://www.acma.gov.au/sites/default/files/2024-05/Fact%20sheet%20-%20email%20and%20SMS%20unsubscribe%20rules.pdf) — DCEM definition and unsubscribe exemption
- [ACMA SMS Sender ID Register — SwiftDigital summary](https://swiftdigital.com.au/sms-sender-id-acma-legislation/) — 1 July 2026 deadline, transactional messages not exempt
- [ClickSend ACMA Alpha Tag registration](https://help.clicksend.com/en/articles/46062-acma-upcoming-changes-to-alphanumeric-senderids-alpha-tags-registration-usage) — registration requirements, ABN, ACMA Assist
- [ClickSend Managing opt-outs](https://help.clicksend.com/en/articles/43124-managing-opt-outs) — STOP keyword, account-level opt-out list, alpha tag limitation
- [ClickSend URL Shortening](https://developers.clicksend.com/docs/messaging/url-shortening) — smsu.io domain, `shorten_urls` parameter, click tracking, vetting requirement
- [ClickSend Send SMS API](https://developers.clicksend.com/docs/messaging/sms/other/send-sms) — `custom_string`, `shorten_urls`, `from` (sender ID) parameters
- [Upstash QStash + Next.js](https://upstash.com/blog/email-scheduler-qstash) — `notBefore` parameter for one-off delayed delivery
- [Transactional SMS Best Practices — Omnisend 2026](https://www.omnisend.com/blog/transactional-sms/) — copy principles, anti-spam practices
- [MEF — ACMA SMS Sender ID Register 2026](https://mobileecosystemforum.com/2025/10/15/australias-acma-announces-sms-sender-id-register-for-2026/) — registration timeline, carrier blocking of unregistered IDs
- [DLA Piper — Electronic marketing in Australia](https://www.dlapiperdataprotection.com/countries/australia/electronic-marketing.html) — DCEM definition, Spam Act Schedule 1 reference

---

*Feature research for: Transactional SMS nudges — Aquarius Lawyers document-upload flow*
*Researched: 2026-04-24*
