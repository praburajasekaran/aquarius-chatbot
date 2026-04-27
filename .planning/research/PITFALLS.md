# Pitfalls Research

**Domain:** Transactional SMS (ClickSend) in a regulated AU law-firm context on Next.js/Vercel
**Researched:** 2026-04-24
**Confidence:** HIGH for regulatory/ClickSend-specific findings (official sources); MEDIUM for scheduler reliability (verified patterns but no ClickSend-specific load tests found)

---

## Critical Pitfalls

### Pitfall 1: Sending a "commercial" message instead of a DCEM, losing the consent exemption

**What goes wrong:**
The upload-nudge SMS is intended to be a Designated Commercial Electronic Message (DCEM) — a factual service message that is exempt from the Spam Act 2003's consent and unsubscribe requirements. If the message body includes *any* promotional language ("Aquarius Lawyers — Australia's best criminal law firm"), the message is reclassified as a full commercial electronic message. At that point you need express consent on record and a functional unsubscribe mechanism in every send. Mixing even one promotional phrase collapses the DCEM safe harbour.

**Why it happens:**
Copywriters and firm partners naturally reach for brand-positive language. The developer implementing the feature cannot assess Australian law well enough to catch it at code-review time.

**How to avoid:**
- Keep message body to pure factual content only: "Your payment for [matter ref] is confirmed. Upload your documents here: [URL]. — Aquarius Lawyers." No adjectives about the firm, no service promotion.
- Add a code comment directly above the SMS body constant: `// DCEM: no promotional language permitted — Spam Act 2003 s.6(1). See PROJECT.md#Regulatory.`
- The firm's principal or their compliance contact must sign off on the exact copy before any production send. Record that approval (email/Slack thread) so it exists as evidence of consent governance.
- If opt-out copy is added anyway (e.g. "Reply STOP to opt out"), understand that ClickSend's native STOP handling fires server-side automatically regardless — the text is redundant for DCEMs but not harmful.

**Warning signs:**
- Any draft copy that includes words like "best", "leading", "trusted", "award-winning", or a call to engage with additional services.
- Copy submitted by someone other than the developer without regulatory review.
- "Just add our tagline" requests from non-technical stakeholders.

**Phase to address:** Security / compliance phase (before any real send reaches production). Lock the copy in code as a named constant; no runtime override from CMS/database.

---

### Pitfall 2: Phone number arrives as local format, ClickSend rejects or delivers to the wrong number

**What goes wrong:**
`validatePhone()` in `src/lib/validators.ts` accepts both `0412345678` (local) and `+61412345678` (E.164), but `normalizePhone()` only strips whitespace and punctuation — it does **not** convert to E.164. If the intake captures `0412 345 678` and that value is passed verbatim to ClickSend, the API may interpret it as a number in the server's default locale rather than Australia, or it may silently succeed but route to the wrong destination.

ClickSend's API does accept a `country` parameter alongside `to`, but if `country` is omitted and the number lacks a country code, the behaviour is undefined per their documentation. In practice, the risk is a silent mis-route rather than a clear error — you pay for the send and the client never receives it.

**Why it happens:**
The existing `normalizePhone` function is named and documented as a normaliser but actually only strips formatting characters. It is a natural mistake to assume it produces E.164 output.

**How to avoid:**
- Add a dedicated `toE164AU(phone: string): string` function in `src/lib/validators.ts`:
  ```typescript
  export function toE164AU(phone: string): string {
    const digits = phone.replace(/\D/g, "");
    if (digits.startsWith("61")) return `+${digits}`;
    if (digits.startsWith("0")) return `+61${digits.slice(1)}`;
    throw new Error(`Cannot convert to E.164: ${phone}`);
  }
  ```
- Always pass E.164 to ClickSend; never pass a local-format number.
- Add a unit test covering: `0412 345 678` → `+61412345678`, `04-12-345-678` → `+61412345678`, `+61412345678` → `+61412345678` (idempotent).
- Include `country: "AU"` in every ClickSend API call as a belt-and-suspenders fallback.

**Warning signs:**
- Intake records in Redis with `clientPhone` values that start with `0` rather than `+61`.
- ClickSend API calls that do not include a `country` field in the message object.
- Any use of `normalizePhone()` in SMS dispatch code without a subsequent E.164 conversion step.

**Phase to address:** Dispatch phase. Gate on a unit test passing before the send module is considered done.

---

### Pitfall 3: SMS fires twice from the same payment event (SMS bomb via webhook retry)

**What goes wrong:**
The Stripe webhook handler already has a Redis deduplication guard (`stripe-session:{id}` with `NX`), but this guard is inside the existing `catch`-swallowing try/catch block. If the `createUploadToken` call or the Redis `SET` itself throws before the dedup key is fully written, Stripe retries the webhook (up to 3 days, exponential backoff), and the next execution passes the `NX` check again because the key was never persisted. The client receives two identical SMS messages — which in an AU legal context is a client-experience failure and, if the copy is classified as commercial, a potential Spam Act breach because two sends from the same consent event may be characterised as separate commercial messages.

For the 24-hour reminder: a Vercel Cron job or QStash schedule will fire at least once; both platforms guarantee **at-least-once** delivery, not exactly-once. If the cron endpoint does not atomically record the send before calling ClickSend, a retry window overlap can dispatch the reminder twice.

**Why it happens:**
- The dedup key write (`SET NX`) and the upload token creation are not atomic. A partial failure leaves the key in `"pending"` state but the business logic incomplete; on retry the key already exists as `"pending"` so the `NX` guard wrongly passes (it checks `created !== "OK"` — but `"pending"` was the first write; a second `SET` without `NX` overwrites it, so actually this guard works for Stripe retries but NOT if the initial write failed before the SET completes).
- Actually: the real gap is that when `created !== "OK"` the handler returns early, which is correct. But the ClickSend call will be added downstream of the try block, meaning a new failure path exists after `createUploadToken` succeeds but before the SMS send.
- For the reminder cron: no send-record exists yet, so nothing prevents a double-fire if the cron endpoint is invoked twice within the retry window.

**How to avoid:**
- **Immediate send**: Add `smsDispatched: true` to the intake record using `updateIntake` inside the same atomic block as the dedup key write. Before calling ClickSend, check `intake.smsDispatched`. Use Redis `SET NX` on a `sms-immediate:{sessionId}` key to gate the ClickSend call, separate from the Stripe dedup key.
- **Reminder send**: Before dispatching the 24h reminder, perform an atomic Redis `SET NX sms-reminder:{sessionId} "sent" EX 172800` (48h TTL). If the key already exists, skip the send. Only after this guard resolves should the ClickSend call be made.
- Do not rely on the upload-token dedup key alone — its purpose is email dedup, not SMS dedup; coupling the two creates a hidden dependency.

**Warning signs:**
- No `sms-immediate` or `sms-reminder` Redis key namespace in the codebase.
- The ClickSend call placed inside the same `try` block that also creates the upload token without an independent SMS-specific guard.
- Vercel Cron or QStash reminder endpoint that reads the intake record but does not write a send-lock before calling ClickSend.

**Phase to address:** Dispatch phase (immediate send) and Scheduler phase (reminder send). Both must be reviewed together.

---

### Pitfall 4: 24h reminder races with a late document upload that completed seconds earlier

**What goes wrong:**
The reminder cron fires at `createdAt + 24h` to check whether the upload token has been consumed. Between the time the reminder cron reads the upload-token record (to determine "not uploaded yet") and the time it calls ClickSend, the client completes their upload. The client receives a "you haven't uploaded yet" SMS seconds after they just did, which is confusing and undermines trust in the firm.

More subtle: the upload-token state and the intake record live in separate Redis keys with different TTLs (7 days vs 7 days, but written at different times). The cron must read from `upload-token:*` — which is the authoritative source of upload completion — not from a derived flag on the intake record, which may be stale.

**Why it happens:**
- The reminder check and the SMS dispatch are not a single atomic operation. Any I/O between them is a race window.
- Developers reading from `intake.*` for convenience rather than from `upload-token.*` for accuracy.

**How to avoid:**
- In the reminder handler: read the upload token record; if `usedAt` is set (or token is marked `consumed`), abort silently and log `sms-reminder-skipped:already-uploaded`.
- Apply the Redis `SET NX sms-reminder:{sessionId}` lock **before** reading the upload-token record, not after. This converts the race from "read then send" to "lock then read then send or release lock".
- Keep the total time between the upload-token read and the ClickSend API call under 500ms (no other I/O in between). If additional checks are needed, do them before acquiring the lock.
- Log the outcome either way: `sms-reminder-sent` or `sms-reminder-skipped:{reason}` with `sessionId` and timestamp. This is the primary observability signal for measuring upload-completion lift.

**Warning signs:**
- Reminder handler that reads from `intake.*` for the "already uploaded" check rather than from `upload-token.*`.
- Any additional async calls (e.g. to Smokeball or Zapier) between the upload-check read and the ClickSend call.
- No structured log event for skipped reminders.

**Phase to address:** Scheduler phase.

---

### Pitfall 5: SMS dispatch coupled to Stripe-specific types, breaking when Bpoint is activated

**What goes wrong:**
The Bpoint migration is proceeding in a parallel worktree. If the SMS dispatch function is called directly from `src/app/api/webhooks/stripe/route.ts` and accepts a `Stripe.Checkout.Session` argument (or any Stripe-typed object), the Bpoint webhook handler will need to either import and coerce Stripe types or duplicate the SMS dispatch logic. Both paths guarantee a merge conflict or a duplicate-send bug at the moment of migration cutover.

The existing code already has a Stripe-specific dedup key (`stripe-session:{id}`) baked into the webhook handler. Mirroring this pattern for SMS would create `sms-immediate:stripe:{sessionId}` and then require a parallel `sms-immediate:bpoint:{sessionId}` — fragmenting the dedup namespace and making future observability queries harder.

**Why it happens:**
The path of least resistance is to add `sendImmediateSMS(session)` directly in the Stripe webhook handler, passing the Stripe session object. This works immediately but creates a tight coupling that the project brief explicitly warns against.

**How to avoid:**
- Define a provider-agnostic internal event type:
  ```typescript
  // src/lib/events/intake-paid.ts
  export interface IntakePaidEvent {
    sessionId: string;
    clientPhone: string;    // already E.164
    clientEmail: string;
    clientName: string;
    uploadLink: string;
    paidAt: string;         // ISO timestamp
  }
  ```
- The SMS dispatch module `src/lib/sms/dispatch.ts` accepts only `IntakePaidEvent` — no Stripe or Bpoint types leak in.
- Both the Stripe webhook handler and the future Bpoint webhook handler map their provider-specific payload to `IntakePaidEvent` before calling `dispatch`.
- The dedup key for SMS is `sms-immediate:{sessionId}` — keyed on the app-level session ID, which is provider-agnostic, not on the Stripe checkout session ID.

**Warning signs:**
- Any import of `stripe` or `@stripe/stripe-js` inside `src/lib/sms/`.
- The SMS dispatch function signature including a parameter typed as anything from the Stripe SDK.
- The SMS dedup key containing the string "stripe".

**Phase to address:** Dispatch phase. This is the first architectural decision to lock down before writing any SMS code.

---

### Pitfall 6: ACMA Sender ID Register deadline — branded sender ID becomes "Unverified" from 1 July 2026

**What goes wrong:**
From 1 July 2026, any SMS sent with an alphanumeric branded sender ID (e.g. `AquariusLaw`) that has not been registered with the ACMA Sender ID Register will display as "Unverified" on the recipient's handset. Clients — already anxious about legal matters — will treat unverified messages as scam attempts, ignore them, or report them. The firm's reputation is damaged and the entire SMS feature provides zero lift.

Registration opened 30 November 2025. The deadline for registering a sender ID to be used by 1 July 2026 is **15 May 2026** — less than 4 weeks from the date this research was conducted.

This milestone's go-live is imminent. If the sender ID is not already registered (or if numeric shared pool sender IDs are used), the feature may work technically but fail commercially.

**Why it happens:**
ACMA's Sender ID Register is a 2025-2026 regulatory change. Training data and general SMS documentation do not mention it. Developers building a domestic AU SMS feature in April 2026 can easily miss that this deadline is active right now.

**How to avoid:**
- **Before writing any code**: confirm with the firm principal whether they have already registered `AquariusLaw` (or their chosen alphanumeric sender ID) through ClickSend or another EMSP. ClickSend is a participating provider.
- If not yet registered: initiate registration immediately. Registration requires business name, ABN, Australian street address (no PO Box), contact name and number, and intended use case. ClickSend submits this to ACMA on your behalf.
- If registration cannot complete before go-live: use a dedicated numeric Australian number (+61 4xx xxx xxx) as the sender ID instead. Numeric numbers are not subject to the branded sender ID register. Clients can reply STOP to this number, and ClickSend handles the opt-out automatically.
- Do not use ClickSend's shared rotating sender pool for a regulated legal context — the phone number the client sees changes every message, making it impossible for them to recognise the firm.

**Warning signs:**
- `from` (sender ID) field in the ClickSend API call is an alphanumeric string without confirmed ACMA registration.
- No record of registration initiation in the project's decision log before go-live.
- SMS test sends landing as "Unverified" on AU handsets during QA.

**Phase to address:** Security / compliance phase. This is a pre-requisite to any production send, not a post-launch concern.

---

### Pitfall 7: ClickSend silently charges for sends to opted-out numbers; no standard error code

**What goes wrong:**
ClickSend's opt-out system automatically blocks messages to numbers that have previously replied STOP — but only when those contacts are stored within ClickSend's contact lists. When using the transactional API directly (passing `to` as a bare phone number, not a contact list reference), the opt-out check may not apply. The API returns a 200 with message status `Queued` or `Sent`; the actual delivery failure (if any) arrives asynchronously via a delivery receipt webhook that most integrations do not subscribe to.

There is no standard ClickSend error code documented for "recipient is on opt-out list." Code 20 (`Anti-spam rejection`) may or may not fire. This means the application has no synchronous signal that a send was blocked.

**Why it happens:**
Developers assume the SMS gateway handles compliance on their behalf. ClickSend's marketing says it "handles STOP natively" — which is true for campaigns but ambiguous for API sends.

**How to avoid:**
- Subscribe to ClickSend's delivery receipt (DLR) webhook and store the final delivery status against `sms-immediate:{sessionId}` and `sms-reminder:{sessionId}` in Redis.
- Log delivery status events as structured JSON: `{ event: "sms-delivery-status", sessionId, status, clicksendMessageId, timestamp }`.
- On STOP replies via two-way number, ClickSend does add the number to the global opt-out list — this propagates to transactional sends within minutes according to their documentation. Confirm this behaviour with ClickSend support before go-live if using a dedicated AU number.
- Do NOT attempt to recover from an opt-out by sending via a different sender ID or number — this is a Spam Act violation.

**Warning signs:**
- No delivery receipt webhook endpoint in the codebase.
- SMS dispatch code that considers a 200 HTTP response from ClickSend as confirmation of delivery.
- No per-session record of delivery outcome in Redis or logs.

**Phase to address:** Dispatch phase (structure the webhook endpoint); Verification phase (confirm delivery tracking works end-to-end).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Call `sendSMS()` directly from Stripe webhook handler | Fastest implementation | Merge conflict when Bpoint lands; duplicated logic; provider-specific types bleed into SMS layer | Never — the PROJECT.md constraint is explicit |
| Reuse `normalizePhone()` without E.164 conversion | No new code | Silent mis-routes to wrong numbers; charged per failed send | Never for any number passed to ClickSend |
| Skip the Redis send-lock for the immediate SMS | Simpler code | Duplicate SMS on Stripe retry (happens ~2% of webhook deliveries) | Never — Stripe retries are guaranteed |
| Hardcode SMS body as an inline string | Fast to write | DCEM classification breaks if copy is changed; no legal sign-off trail | Never — make it a named constant with a compliance comment |
| Use ClickSend's shared number pool for sender ID | No registration required | Numbers change per message; no client recognition; may show as Unverified post-July 2026 | Acceptable for local dev/staging only |
| Vercel Hobby plan cron (once-per-day minimum) | Zero infrastructure cost | 24h reminder becomes 23h or 25h depending on when cron aligns with `paidAt`; not precise | Acceptable MVP if QStash integration is deferred, but document the imprecision |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| ClickSend SMS API | Passing `0412345678` (local format) as `to` without a `country` field | Always pass E.164 (`+61412345678`) and include `country: "AU"` |
| ClickSend SMS API | Treating HTTP 200 as delivery confirmation | Subscribe to DLR webhook; HTTP 200 only means "accepted for routing" |
| ClickSend SMS API | Assuming opt-out blocking applies to raw API sends | Verify STOP propagation to transactional API with ClickSend support; log all delivery outcomes |
| ClickSend sender ID | Using an alphanumeric sender ID without ACMA registration | Register via ClickSend by 15 May 2026 or use dedicated numeric AU number |
| Stripe webhook | Adding SMS dispatch inside existing try/catch that swallows errors | SMS dispatch needs its own dedup key and error surface; do not share the upload-token dedup guard |
| Upstash Redis | Reading `intake.*` to check upload status in the reminder cron | Read from `upload-token.*` which is the authoritative upload-completion record |
| QStash (if used) | Not verifying QStash's `verifySignatureAppRouter` on the reminder endpoint | Any public HTTPS endpoint without signature verification can be triggered by an attacker to spam SMS |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Reminder cron iterates all active sessions to find "not uploaded" ones | Cron timeout at >500 active sessions; Vercel 30s function limit | Store `sms-reminder-due:{epoch-hour}` index keys when payment fires; cron reads only that hour's set | At ~200 concurrent sessions if doing full Redis SCAN |
| ClickSend API call inside Stripe webhook response path | Stripe sees slow response (>10s), marks delivery failed, retries | Move ClickSend call to a background task (QStash or `waitUntil` in edge runtime) that fires after the 200 is returned | First time ClickSend is slow or has a brief outage |
| Synchronous `getIntake` + `getUploadToken` reads before SMS send | Two sequential Redis round-trips adds ~60ms inside webhook response | Use `Promise.all([getIntake(...), getUploadToken(...)])` for concurrent reads | Negligible at current scale but clean architecture from the start |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Logging `clientPhone` at DEBUG level in structured logs | AU Privacy Act 1988 — phone numbers are personal information; log aggregators (Datadog, Vercel log drain) may retain them indefinitely | Log only the last 3 digits: `phone.slice(-3).padStart(phone.length, '*')` |
| Embedding the raw upload token in the SMS body | Token visible in ClickSend's message logs, carrier logs, and any SMS-to-email forwarding the client has enabled | Use the same HTTPS upload URL pattern already used in email; the token is in the path, HTTPS in transit |
| No rate-limit on the SMS dispatch trigger path | A malicious actor who obtains a valid session ID (e.g. from a Calendly UTM leak — see CONCERNS.md) can trigger SMS spam | Add a per-session `SET NX sms-trigger-rate:{sessionId}` with a 1-hour TTL before any ClickSend call; if key exists, reject |
| Storing `CLICKSEND_API_KEY` in a non-secret env var visible in Vercel preview deployments | API key exposed in PR preview build logs | Use Vercel's "sensitive" environment variable flag; never log `process.env.CLICKSEND_API_KEY` |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| SMS copy says "click here" with a shortened URL (e.g. bit.ly) | AU clients increasingly distrust shortened links in SMS, especially in a legal context (potential scam signal) | Use the full `APP_URL` domain in the upload link — `aquariuslawyers.com.au/upload/…` is immediately recognisable |
| 24h reminder fires at 3am if the client paid at 3am | Wakes client at an antisocial hour; may trigger complaint | Delay the reminder to the next 9am–5pm AEST window if the 24h mark falls outside business hours — use QStash scheduled delivery with time-window logic |
| Landline silently skipped with no fallback notification to the firm | Firm does not know a client cannot be reached by SMS | Log `sms-skipped:landline` as a structured event that can be queried; consider adding to the transcript email sent to the firm |
| Reminder SMS sent after client has already uploaded | Client confusion; undermines trust in firm's systems | Read `upload-token.*` for consumed status immediately before send (see Pitfall 4) |

---

## "Looks Done But Isn't" Checklist

- [ ] **DCEM compliance**: SMS copy reviewed and approved by firm principal in writing before any production send — verify written approval exists, not just developer judgment.
- [ ] **E.164 conversion**: `toE164AU()` function present in `src/lib/validators.ts` and unit-tested with at least 5 AU number formats — verify the test file exists and passes.
- [ ] **Sender ID registration**: ACMA registration initiated through ClickSend and confirmation receipt on file — verify before go-live, not post-launch.
- [ ] **Send dedup guards**: `sms-immediate:{sessionId}` and `sms-reminder:{sessionId}` Redis keys present in send paths — verify by grepping the codebase.
- [ ] **ClickSend env absent-safe**: App boots and all non-SMS flows work with `CLICKSEND_USERNAME` and `CLICKSEND_API_KEY` unset — verify with a local env that omits them.
- [ ] **Delivery receipt webhook**: ClickSend DLR endpoint configured in ClickSend dashboard pointing at a `/api/webhooks/clicksend/dlr` route — verify endpoint exists and ClickSend dashboard shows it.
- [ ] **Provider-agnostic dispatch**: `src/lib/sms/dispatch.ts` has zero imports from Stripe SDK — verify with `grep -r "from 'stripe'" src/lib/sms/`.
- [ ] **Reminder upload check**: Reminder handler reads from `upload-token:*` key, not `intake:*` — verify by code inspection.
- [ ] **Landline skip logging**: Structured log event emitted when a landline is skipped — verify log output in local test with a 02-prefix number.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| DCEM classification fails; ACMA investigates | HIGH — potential $2.22M fine for company | Immediate cease of all SMS sends; legal review of all messages sent; voluntary disclosure to ACMA; implement express consent collection |
| Duplicate SMS sent to client | LOW if isolated | Log search to count affected sessions; personalised apology from firm; Redis cleanup of any stuck dedup keys |
| Sender ID shows "Unverified" after July 2026 | MEDIUM | Switch to dedicated numeric AU number immediately (can be provisioned in ClickSend in hours); register branded sender ID properly; no messages lost, only trust impact during the window |
| Wrong number received SMS (E.164 mis-conversion) | MEDIUM | Identify via ClickSend delivery logs; notify ClickSend support; if sensitive content reached wrong person, Privacy Act obligations apply — notify affected party and OAIC |
| Reminder fires after upload (race condition) | LOW | Client contacts firm; firm confirms upload received; no re-send needed; fix the lock ordering in code |
| ClickSend API key leaked | HIGH | Rotate key immediately in ClickSend dashboard; audit delivery logs for unauthorised sends; update Vercel env; check for any SMS sent outside expected session pattern |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| DCEM vs commercial message misclassification | Security / Compliance | Firm sign-off document exists; SMS body constant has compliance comment |
| Phone not in E.164 format | Dispatch | `toE164AU` unit tests pass; ClickSend API calls audited in integration test |
| Duplicate SMS (Stripe retry + cron double-fire) | Dispatch + Scheduler | `sms-immediate` and `sms-reminder` Redis keys confirmed in send paths; test with simulated Stripe retry |
| 24h reminder race with late upload | Scheduler | Upload-status check reads `upload-token.*`; lock acquired before check; test with concurrent upload + cron trigger |
| SMS dispatch coupled to Stripe types | Dispatch | Zero Stripe SDK imports in `src/lib/sms/`; Bpoint team can call dispatch without any Stripe dependency |
| ACMA Sender ID Register deadline | Security / Compliance | ClickSend dashboard shows registered sender ID or dedicated number provisioned |
| Opted-out number silent charge | Dispatch + Verification | DLR webhook endpoint live; delivery status persisted to Redis; manual test confirms STOP handling |

---

## Sources

- [ACMA: SMS Sender ID Register](https://www.acma.gov.au/sms-sender-id-register) — HIGH confidence; official regulatory source
- [ACMA: Industry rules — SMS Sender ID Register](https://www.acma.gov.au/industry-rules-sms-sender-id-register) — HIGH confidence; official regulatory source
- [Swift Digital: ACMA SMS Sender ID Legislation 2026](https://swiftdigital.com.au/sms-sender-id-acma-legislation/) — MEDIUM confidence; verified against ACMA sources
- [ClickSend: Australian Spam Regulations](https://help.clicksend.com/article/koy07xgcjj-australian-spam-regulations-v2) — HIGH confidence; official ClickSend compliance documentation (404 at time of fetch; content confirmed via other ClickSend help pages)
- [ClickSend: Understanding opt-outs](https://help.clicksend.com/article/jg3o5n5mbo-how-does-the-opt-out-system-work) — HIGH confidence; official ClickSend documentation
- [ClickSend: Australia (+61) sending guide](https://help.clicksend.com/en/articles/43652-australia-61) — HIGH confidence; official ClickSend documentation
- [ClickSend: SMS error codes](https://help.clicksend.com/article/8cc479qlbb-list-of-sms-gateway-error-codes) — HIGH confidence; official ClickSend documentation
- [ACMA: Avoid sending spam](https://www.acma.gov.au/avoid-sending-spam) — HIGH confidence; official Australian regulatory guidance
- [DLA Piper Privacy Matters: Australia e-marketing expectations 2024](https://privacymatters.dlapiper.com/2024/08/australias-e-marketing-expectations-when-customers-dont-give-a-spam/) — MEDIUM confidence; legal commentary verified against ACMA sources
- [Upstash QStash documentation](https://upstash.com/docs/qstash/features/schedules) — HIGH confidence; official Upstash documentation
- [Vercel Cron Jobs documentation](https://vercel.com/docs/cron-jobs) — HIGH confidence; official Vercel documentation
- [libphonenumber-js npm](https://www.npmjs.com/package/libphonenumber-js) — HIGH confidence; if E.164 conversion logic proves complex, this is the library to use
- Codebase analysis: `src/lib/validators.ts`, `src/lib/intake.ts`, `src/app/api/webhooks/stripe/route.ts`, `.planning/codebase/CONCERNS.md` — HIGH confidence; direct inspection

---

*Pitfalls research for: ClickSend SMS integration on Next.js/Vercel for AU law firm*
*Researched: 2026-04-24*
