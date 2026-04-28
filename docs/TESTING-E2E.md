# End-to-End Test Plan — Aquarius Chatbot

**Generated:** 2026-04-28 from current `main` worktree (`youthful-booth-571837`).
**Scope:** Every user-visible action and the exact events it fires (emails, SMS, Smokeball/Zapier, Calendly, attachments).

> Read this top-to-bottom once; then walk the **Test Walkthrough** section in order. Each step lists the *exact* side effects so you know what to check before moving on.

---

## 0. Pre-flight

### 0.1 Demo mode vs. real Stripe

Two payment paths exist. **Pick one and confirm before the demo:**

| Mode | Trigger | Path |
|---|---|---|
| **Demo bypass** | `NEXT_PUBLIC_DEMO_BYPASS_PAYMENT=true` | `<DemoPaymentCard>` shows "Pay (Success)" / "Pay (Fail)" buttons → `POST /api/intake/bypass-paid` → `handleIntakePaid()` |
| **Real Stripe** | env var unset/false | Embedded Stripe Checkout → Stripe webhook → legacy fan-out in `route.ts` (does **NOT** call `handleIntakePaid`) |

> ⚠ **Behavior gap to know about**: the real Stripe webhook ([src/app/api/webhooks/stripe/route.ts](src/app/api/webhooks/stripe/route.ts)) fans out **payment receipt + firm transcript only** — it does *not* send the immediate client SMS, schedule the 24h reminder, or send the urgent-firm SMS. The demo bypass *does*, because it routes through `handleIntakePaid()`. If the demo will use real Stripe and SMS matters, this is a known regression.

### 0.2 Required env vars

| Var | Used by | Effect if missing |
|---|---|---|
| `OPENROUTER_API_KEY` | Chat | Chat 500s |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Everywhere | Sessions/intake fail |
| `STRIPE_SECRET_KEY` / `_WEBHOOK_SECRET` | Real-payment path | Checkout/webhook fail |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Embedded checkout | Stripe iframe fails |
| `NEXT_PUBLIC_DEMO_BYPASS_PAYMENT=true` | Demo path | Real Stripe used |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | All emails | Emails skipped (logged) |
| `FIRM_NOTIFY_EMAIL` | Firm lead, firm transcript, late-upload firm notify, Calendly booking | Falls back to `prabu@paretoid.com` for some senders; late-upload notify is silently skipped |
| `FIRM_NOTIFY_PHONE` | URGENT-only firm SMS | Skipped (logged) |
| `CLICKSEND_USERNAME` / `_API_KEY` / `_SENDER_ID` | All client SMS | SMS skipped (logged) |
| `QSTASH_TOKEN` | 24h reminder SMS | Reminder not scheduled |
| `APP_URL` | Upload links + reminder webhook URL | `handleIntakePaid` throws |
| `NEXT_PUBLIC_URL` | Resume-checkout link in client email | Email link broken |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob uploads | All uploads fail |
| `ZAPIER_ATTACH_WEBHOOK_URL` | Smokeball file attach (late upload) | Logged failure; firm email tagged "MANUAL REQUIRED" |
| `ZAPIER_AUDIT_WEBHOOK_URL` | Audit trail (late upload) | Logged failure only |
| `SMOKEBALL_CAPTURE_SECRET` | Zap #1 → matter mapping | Endpoint 401s; later late uploads tagged "MANUAL REQUIRED" |
| `CALENDLY_WEBHOOK_SIGNING_KEY` | Calendly → firm booking email | 401s; firm not notified about bookings |
| `UPLOAD_COOKIE_SECRET` | Late-upload session cookie | Late upload page 401s |
| `CRON_SECRET` | Blob retention cron | Cron 401s |

### 0.3 Env-name mismatches to double-check

`.env.example` has these stale names — code reads the *new* names. If your `.env.local` was copied from `.env.example`, fix these:

| In `.env.example` | Code actually reads |
|---|---|
| `FIRM_NOTIFICATION_EMAIL` | `FIRM_NOTIFY_EMAIL` |
| `URGENT_SMS_RECIPIENT` | `FIRM_NOTIFY_PHONE` |

### 0.4 Where to watch during testing

- **Vercel logs** (or `npm run dev` console) — look for `[stripe-webhook]`, `[intake]`, `[sms]`, `[late-upload]`, `[calendly-webhook]`, `[smokeball-capture]` lines.
- **Inboxes**: client email (whatever you typed in chat), firm email (`FIRM_NOTIFY_EMAIL`).
- **Phones**: client phone (whatever you typed in chat), firm phone (`FIRM_NOTIFY_PHONE`) — urgent only.
- **Upstash Redis console**: `intake:{sessionId}`, `session:{sessionId}`, `transcript:{sessionId}`, `stripe-session:{sessionId}`, `sms-reminder:{sessionId}`, `sms-reminder-sent:{sessionId}`, `uploaded:{sessionId}`, `session-matter:{sessionId}`.
- **Vercel Blob dashboard** — `uploads/{sessionId}/...` (in-chat) and any path (late uploads, no prefix).
- **Stripe dashboard** — Checkout sessions tab (real mode).
- **Calendly dashboard** — Scheduled events.
- **Zapier history** — Zap #1 (matter create), Zap #2 (file attach), Audit zap.

---

## 1. Reference: chat tools and their effects

Eight tools defined in [src/lib/tools/index.ts](src/lib/tools/index.ts). Server-resolved tools fire side effects; client-rendered tools render UI and return when the user completes the action.

| Tool | Resolved by | Side effects |
|---|---|---|
| `matchQuestion` | server | Reads `src/lib/knowledge-base/criminal-law.json`. **No external effects.** |
| `collectDetails` | server | Validation only. **No external effects.** |
| `selectUrgency` | server | Writes Redis `intake:{sessionId}` (TTL 7d). Sends **client inquiry email** + **firm lead email**. |
| `initiatePayment` | client (PaymentCard) | Creates Stripe Checkout session OR demo button. Writes `intake.stripeSessionId`. |
| `uploadDocuments` | client (DocumentUpload) | `POST /api/upload` per batch → Vercel Blob → updates Redis `session.uploadRefs` → **fires Zapier ATTACH + AUDIT zaps** (one each per file, `source: "chatbot/in-chat-upload"`). |
| `showOptions` | server | Renders chips. **No effects.** |
| `scheduleAppointment` | client (CalendlyEmbed) | Renders Calendly iframe. The inline widget itself doesn't post to your server — Calendly's own webhook does. |
| `showUrgentContact` | client (UrgentContactCard) | Renders firm phone card. **No effects.** |

---

## 2. Side-effect map per user action

### 2.1 — User opens the page

- Generates `sessionId` client-side (`s_{ts}_{rand}`).
- Renders welcome chips: "I've been charged" / "I need bail advice" / "Ask about fees" / "Something else".
- **No server hits.**

### 2.2 — User sends a message

- `POST /api/chat` with `{ messages, sessionId }`.
- **Side effect:** Redis `transcript:{sessionId}` is overwritten with the running transcript (`Client: ... / Chatbot: ...`, TTL 7d). The transcript is what later goes into the firm post-payment email.
- LLM streams; tool calls follow the system prompt's flow.

### 2.3 — Knowledge-base Q&A turn

- Tool: `matchQuestion`.
- Effect: KB lookup only.

### 2.4 — User submits name/email/phone/matter

- Tool: `collectDetails`.
- Effect: validates; if invalid, errors are returned verbatim to the LLM and shown to the user.

### 2.5 — **User picks urgency** (Step 4 → Step 5)

This is the **first big fan-out**.

Tool `selectUrgency` runs server-side:

| Event | Where | Notes |
|---|---|---|
| Redis write `intake:{sessionId}` | Upstash | TTL 7d. Holds clientName/Email/Phone/matterDescription/urgency/displayPrice/amountCents. |
| **Email → client** | Resend | Subject: "Your `{Initial Deposit for Urgent Court Matter \| Legal Strategy Session}` inquiry — `{firmName}`". Includes resume-payment button (`/api/checkout/resume?session=...`) and either firm phone (urgent) or Calendly link (non-urgent). |
| **Email → firm** (`FIRM_NOTIFY_EMAIL`) | Resend | Subject: "New `{urgency}` inquiry — `{name}` (awaiting payment)". Has resume-payment link. **No transcript yet** (transcript goes after payment). |
| **No SMS yet.** | — | SMS only fires after payment. |

> Calendly link in the client email is `CALENDLY_BOOKING_URL` (server-side env var). The Calendly *embed* during the in-chat flow uses `NEXT_PUBLIC_CALENDLY_BOOKING_URL`. If those differ, two paths point at different Calendly events — verify both.

### 2.6 — User clicks "Yes, please proceed" → payment card renders

- Tool: `initiatePayment` (no execute, client renders).
- `<PaymentCard>` first calls `GET /api/intake/{sessionId}/pricing` to read pricing from the intake record (server is the source of truth; the LLM never sets the price).
- Branches on `NEXT_PUBLIC_DEMO_BYPASS_PAYMENT`:
  - **Demo:** renders Pay-Success / Pay-Fail buttons.
  - **Real:** calls `POST /api/checkout` → Stripe Checkout session created → `intake.stripeSessionId` updated → embedded iframe loads.

### 2.7 — **Payment success** (the second big fan-out)

#### Demo bypass path → `handleIntakePaid`

`POST /api/intake/bypass-paid` runs through [handle-paid.ts](src/lib/intake/handle-paid.ts):

| # | Event | Where | Notes |
|---|---|---|---|
| 1 | Redis update `session.paymentStatus = "paid"` | Upstash | + `stripeSessionId` (`demo_{sessionId}`), `paymentAmount`. Best-effort. |
| 2 | NX dedupe `stripe-session:{sessionId}` | Upstash | TTL 7d. If already set → returns `duplicate`, no further fan-out. |
| 3 | Mint upload token, store hash in dedupe key | Upstash | Token → upload-link `${APP_URL}/upload/{rawToken}`. |
| 4 | **Email → client** (payment receipt) | Resend | Subject: "Your payment receipt — `{firmName}`". Contains the upload link. React component `PaymentReceipt`. |
| 5 | **Email → firm** (`FIRM_NOTIFY_EMAIL`) | Resend | Subject: "New `{urgency}` Criminal Law Inquiry — `{name}`". Has full table + Stripe ref + **chat transcript** (read from `transcript:{sessionId}`). |
| 6 | **SMS → client** (immediate) | ClickSend | Body: `Aquarius Lawyers: Your payment is confirmed. Please upload your documents here: {uploadLink} — Aquarius Lawyers +61 2 8858 3233`. Skipped if no phone, landline, or no creds. Logs `event: sms_sent`. |
| 7 | **QStash schedule** (24h reminder) | Upstash QStash | Stores `messageId` at `sms-reminder:{sessionId}` (TTL 26h). Logs `event: reminder_scheduled`. |
| 8 | **SMS → firm** (urgent only) | ClickSend → `FIRM_NOTIFY_PHONE` | Body: `Aquarius Lawyers: URGENT paid matter — {name} ({phone}). Check email for details.` Non-urgent → no firm SMS. |

#### Real Stripe path → `webhooks/stripe/route.ts`

Same as above **except**:
- Steps 6 (immediate SMS), 7 (reminder), 8 (urgent firm SMS) **do not run** — only steps 1, 3, 4, 5.
- Source of truth comment in [src/lib/intake/handle-paid.ts:40](src/lib/intake/handle-paid.ts) confirms: *"legacy Stripe path — to be migrated"*.

#### Payment failure (demo)

- Demo card sets state to `failed`, fires `onFail` → tool returns `{ status: "failed" }`.
- LLM responds with the failure message and re-renders payment form.
- **No emails, no SMS, no Redis writes.**

### 2.8 — User uploads documents in-chat

After payment, the LLM calls `uploadDocuments`. This renders `<DocumentUpload>`.

- `POST /api/upload` (multipart) → Vercel Blob (`uploads/{sessionId}/{ts}-{name}`).
- Updates Redis `session.uploadRefs` (limit 5 files, 10MB each, types: PDF/JPG/PNG/DOCX).
- **Fires Zapier ATTACH zap** (`ZAPIER_ATTACH_WEBHOOK_URL`) — one POST per uploaded file, mirroring the late-upload payload (`matter_ref = sessionId`, `source: "chatbot/in-chat-upload"`).
- **Fires Zapier AUDIT zap** (`ZAPIER_AUDIT_WEBHOOK_URL`) — one POST per file, `event: "in_chat_upload.completed"` plus `attach_zap_status`.
- **No firm email** at this step. The firm transcript email already fired at §2.7-#5; per-file emails would be noise.

> ⚠ **Smokeball matter ID is usually `null` here.** Zap #1 (matter creation) runs in parallel with the in-chat upload — by the time the upload completes, the `session-matter:{sessionId}` mapping typically hasn't been captured yet. The ATTACH zap payload contains `smokeball_matter_id: null` in that case. **Zapier-side handling for null IDs (queue / MANUAL REQUIRED) is what determines whether the file lands in the right matter automatically.** Same logic the late-upload path already relies on (§2.10).

### 2.9 — Routing branch (urgent vs. non-urgent)

After `uploadDocuments` resolves, the LLM picks **exactly one** based on the urgency captured at step 2.5:

#### 2.9a — Non-urgent → `scheduleAppointment` → `<CalendlyEmbed>`

- Calendly inline widget loaded (`NEXT_PUBLIC_CALENDLY_BOOKING_URL`).
- Prefilled: name, email, `customAnswers.a1 = matterDescription`, `utm_content = sessionId`.
- On Calendly's `calendly.event_scheduled` postMessage → tool resolves `{ booked, eventStartTime, eventUri, inviteeUri }`.

**Separately, Calendly fires its own webhook** to your `POST /api/webhooks/calendly`:
- Verifies HMAC against `CALENDLY_WEBHOOK_SIGNING_KEY`.
- Reads `payload.tracking.utm_content` (= sessionId) → looks up `intake:{sessionId}`.
- **Email → firm** (`FIRM_NOTIFY_EMAIL`): Subject: `Booking confirmed — {name} — {start time AEST}`. Body has client name/email, urgency, matter, start time (Australia/Sydney), Calendly event URI, invitee URI, Stripe session.

#### 2.9b — Urgent → `showUrgentContact` → `<UrgentContactCard>`

- Renders firm phone (`+61 2 8858 3233`) and business hours (10:00am–5:00pm AEST, Mon–Fri).
- Out-of-hours banner shown when `isInsideBusinessHours()` returns false.
- User clicks "I've called" → tool resolves `{ acknowledged: true }`.
- **No email or SMS** at this step (the urgent firm SMS already fired at step 2.7-#8).

### 2.10 — User clicks the upload link in the receipt email (LATE UPLOAD)

This is the path that delivers documents to Smokeball.

#### Token resolution
- `GET /upload/{token}` → resolves token, sets signed cookie (`COOKIE_NAME`, `UPLOAD_COOKIE_SECRET`-signed), redirects to `/upload/session`.
- IP rate-limited (`getLimiter`).
- Token is single-use-ish: the dedupe key holds the *hash*, lookups go through it.

#### Per-file upload (`<LateUploadClient>` → Vercel Blob direct → callback)
- Client uploads through `@vercel/blob/client.upload()` against `/api/late-upload/session`.
- On `onUploadCompleted`, the server runs [handle-completed.ts](src/lib/late-upload/handle-completed.ts):

| # | Event | Where | Notes |
|---|---|---|---|
| 1 | Magic-byte sniff | `fileTypeFromBuffer` | Mismatch → blob deleted, no events. |
| 2 | `head()` blob meta | Vercel Blob | Read size. |
| 3 | Lookup `session-matter:{sessionId}` (90d TTL) → renew | Upstash | Captured by Zap #1's tail webhook (§2.11). |
| 4 | **Zapier ATTACH** | `ZAPIER_ATTACH_WEBHOOK_URL` | Payload: `{ matter_ref, smokeball_matter_id, session_id, client_email, client_name, file: { url, name, content_type, size_bytes }, uploaded_at, source: "chatbot/late-upload" }`. Two attempts. → Smokeball matter file attach. |
| 5 | **Zapier AUDIT** | `ZAPIER_AUDIT_WEBHOOK_URL` | Payload: `event: "late_upload.completed"` plus all metadata + `attach_zap_status`. |
| 6 | **Email → firm** (`FIRM_NOTIFY_EMAIL`) | Resend (plaintext) | Subject: `[Upload] {name} — {filename}` *or* `[Upload — MANUAL REQUIRED] ...` if attach zap failed or matter mapping was missing. Body includes Smokeball matter ID (or "(not captured — attach manually)"), file URL, status. |
| 7 | **Email → client** (out-of-band confirmation) | Resend | Subject: `We received a file for your matter`. Body invites them to reply if not theirs. |
| 8 | Set `uploaded:{sessionId}` flag | Upstash | TTL 26h. Suppresses the 24h reminder SMS even if QStash cancellation fails. |
| 9 | Cancel pending QStash reminder | QStash | Best-effort. |

### 2.11 — Smokeball matter creation (capture-back)

`POST /api/webhooks/smokeball-matter-created` is called by Zap #1's tail step *after* Zapier creates the Smokeball matter:
- Header `X-Smokeball-Capture-Secret` must match `SMOKEBALL_CAPTURE_SECRET` (timing-safe).
- Body: `{ sessionId, smokeballMatterId }`.
- Effect: writes `session-matter:{sessionId}` → `{ smokeballMatterId, capturedAt }` (TTL 90d).
- This mapping is what step §2.10-#3 reads later.

> Zap #1 itself is **not** triggered by your code. It's configured externally in Zapier (likely off the firm-lead email or the firm-transcript email). If Zap #1 isn't wired, late uploads will arrive at the firm tagged "MANUAL REQUIRED" and the file won't auto-attach in Smokeball.

### 2.12 — 24-hour SMS reminder (QStash callback)

`POST /api/webhooks/sms-reminder` (QStash-signed):
- Reads `uploaded:{sessionId}` → if set, **skips** (logs `reminder_skipped_uploaded`).
- NX-dedupes against `sms-reminder-sent:{sessionId}` (TTL 26h).
- Sends `REMINDER_SMS_COPY(uploadLink)` via ClickSend.

### 2.13 — Daily Blob retention cron

`GET /api/cron/upload-cleanup` (`Authorization: Bearer {CRON_SECRET}`):
- Lists all blobs, deletes anything older than 30 days.
- No email/SMS effect.

---

## 3. Test walkthrough — run these in order

> **Before each run**: clear browser localStorage (or use Incognito). Each `sessionId` is generated fresh per page load — old Redis state from a previous attempt won't poison the run, but inboxes will accumulate.

### Test 1 — Knowledge-base Q&A only

1. Open chatbot. Type: `What happens at a bail hearing?`
2. **Expected**: warm response from KB; **no** Redis writes other than `transcript:{sessionId}`; **no** emails or SMS.
3. **Verify**: Vercel logs show `matchQuestion` tool call; no `[selectUrgency]`, `[stripe-webhook]`, `[intake]`, `[sms]` lines.

### Test 2 — Non-urgent paid intake (happy path)

1. Open chatbot. Say: `I got a parking fine and need help disputing it.`
2. After 1–2 follow-ups, agree to book. Provide: `Test Client / your-test-email@x / 0412 345 678 / [matter auto-derived]`.
3. Pick **Non-urgent — \$726** chip.

   ✅ **Verify (within 30s):**
   - Redis: `intake:{sessionId}` exists with `urgency: "non-urgent"`, `amountCents: 72600`.
   - Email to client: "Your Legal Strategy Session inquiry — Aquarius Lawyers" with resume-payment button + Calendly link.
   - Email to firm (`FIRM_NOTIFY_EMAIL`): "New non-urgent inquiry — Test Client (awaiting payment)".

4. Click "Yes, please proceed" → payment card. Click **Pay (Success)** (demo) or use Stripe test card `4242 4242 4242 4242`.

   ✅ **Verify (within 60s):**
   - Redis: `session:{sessionId}.paymentStatus = "paid"`; `stripe-session:{sessionId}` set.
   - Email to client: "Your payment receipt — Aquarius Lawyers" with **upload link**.
   - Email to firm: "New non-urgent Criminal Law Inquiry — Test Client" with **chat transcript** + Stripe ref.
   - **Demo path only**: SMS to client phone — "Aquarius Lawyers: Your payment is confirmed. Please upload your documents here: {link} — Aquarius Lawyers +61 2 8858 3233".
   - **Demo path only**: Redis `sms-reminder:{sessionId}` set with QStash messageId.
   - **No firm SMS** (urgency is non-urgent).

5. Upload 1–2 files in-chat. Click Continue.

   ✅ **Verify:**
   - Vercel Blob: files at `uploads/{sessionId}/...`.
   - Redis: `session.uploadRefs` has the URLs.
   - Zapier history: ATTACH zap fires (one per file) with `source: "chatbot/in-chat-upload"`, `smokeball_matter_id: null` (or the captured ID if Zap #1 already finished).
   - Zapier history: AUDIT zap fires with `event: "in_chat_upload.completed"`.
   - Vercel logs: `[in-chat-upload] zapier delivery complete` with `file_count` matching what you uploaded.
   - **No firm email** at this step (by design — files arrive in Smokeball via the ATTACH zap).

6. Calendly embed loads. Pick a slot. Submit.

   ✅ **Verify (within 30s of Calendly submit):**
   - In-chat: green "Your session is confirmed" card.
   - Email to firm (`FIRM_NOTIFY_EMAIL`): "Booking confirmed — Test Client — {time}". Has Stripe session, Calendly URIs.
   - Calendly dashboard shows the event.

### Test 3 — Urgent paid intake

Same as Test 2 but in step 3 pick **Urgent — \$1,320**, and skip step 6 (no Calendly).

✅ **Differences to verify:**
- Step 3 emails: subject says "Initial Deposit for Urgent Court Matter"; client email includes firm phone (`+61 2 8858 3233`) instead of Calendly link.
- Step 4 (demo path): **firm SMS to `FIRM_NOTIFY_PHONE`** with "URGENT paid matter — Test Client (0412 345 678). Check email for details."
- Step 6 replaced by Urgent Contact card. User clicks "I've called" → tool resolves; **no further events**.

### Test 4 — Late upload via email link (Smokeball delivery)

Run Test 2 or 3 first to get a payment-receipt email with an upload link.

1. Click the upload link in the receipt email.
2. Page resolves token → cookie set → redirects to `/upload/session`.
3. Drag-drop a PDF. Click Upload.

   ✅ **Verify:**
   - Vercel Blob: file appears (no `uploads/{sessionId}/` prefix this time — it's a flat key).
   - Vercel logs: `[late-upload]` lines (magic-byte ok, head ok, attach zap, audit zap).
   - Zapier history: ATTACH zap fires → Smokeball matter has the file attached.
   - Zapier history: AUDIT zap fires with `attach_zap_status: "ok"`.
   - Email to firm: `[Upload] Test Client — {filename}` with file URL + Smokeball matter ID.
   - Email to client: "We received a file for your matter".
   - Redis: `uploaded:{sessionId}` set; `sms-reminder:{sessionId}` cleared.

4. Wait: do **not** receive the 24h reminder SMS later.

### Test 5 — Late upload before Smokeball matter mapping arrives

Run Test 4 *but* without ever running the Zap #1 tail webhook (i.e. `session-matter:{sessionId}` is missing).

✅ **Verify:**
- Same as Test 4 but ATTACH zap payload has `smokeball_matter_id: null`.
- Firm email subject: `[Upload — MANUAL REQUIRED] Test Client — {filename}`.
- Body contains "Smokeball matter ID: (not captured — attach manually)".

### Test 6 — Smokeball capture-back endpoint

1. From a terminal with the right secret:
   ```bash
   curl -X POST $APP_URL/api/webhooks/smokeball-matter-created \
     -H "X-Smokeball-Capture-Secret: $SMOKEBALL_CAPTURE_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"sessionId":"s_demo","smokeballMatterId":"sb-1234"}'
   ```
2. ✅ **Verify:** 200 with `{ ok, capturedAt }`. Redis: `session-matter:s_demo` set.
3. Try with wrong/no secret → 401.

### Test 7 — Calendly webhook signature

1. Calendly's own webhook hits `/api/webhooks/calendly` with HMAC header.
2. ✅ **Verify:** valid signature → firm gets booking email; bad/missing signature → 401, no email.

### Test 8 — Payment failure (demo)

1. Run Test 2 to step 4. Click **Pay (Fail)**.
2. ✅ **Verify:** LLM responds with retry message; no Redis state changes; no emails; no SMS.

### Test 9 — Stripe webhook idempotency (real path)

1. Replay the same `checkout.session.completed` event in the Stripe CLI.
2. ✅ **Verify:** second delivery is logged as `retry ignored for {sessionId} (already processed)`; no duplicate emails or upload tokens.

### Test 10 — In-chat upload over the limit

1. Try to upload 6 files in step 5 of Test 2.
2. ✅ **Verify:** API returns 400 once `MAX_FILES_PER_SESSION = 5` is hit; `warning` field set on partial batches.

### Test 11 — Out-of-business-hours urgent card

1. If running outside 10am–5pm AEST Mon–Fri, the urgent card shows the amber "we're outside business hours" panel.
2. ✅ **Verify**: matches local time; `useSyncExternalStore` returns null on SSR (no flash).

---

## 4. Cheat sheet — what fires when (one-glance)

```
USER ACTION                       │ EMAILS                     │ SMS                                │ REDIS WRITES                                       │ ZAPIER / WEBHOOKS
──────────────────────────────────┼────────────────────────────┼────────────────────────────────────┼────────────────────────────────────────────────────┼─────────────────────────
Send chat message                 │ —                          │ —                                  │ transcript:{sid}                                   │ —
Pick urgency (Step 4)             │ Client inquiry  +  Firm    │ —                                  │ intake:{sid} (TTL 7d)                              │ —
                                  │ lead ("awaiting payment")  │                                    │                                                    │
Pay (demo success / Stripe ok)    │ Client receipt  +  Firm    │ Client immediate (demo only)       │ session.paymentStatus=paid; stripe-session:{sid};  │ —
                                  │ transcript (with chat log) │ +  Firm urgent (urgent + demo only)│ sms-reminder:{sid}                                 │
                                  │                            │ +  24h reminder scheduled (demo)   │                                                    │
Pay (demo fail)                   │ —                          │ —                                  │ —                                                  │ —
In-chat document upload           │ —                          │ —                                  │ session.uploadRefs                                 │ Zapier ATTACH + AUDIT (per file)
Calendly book (non-urgent)        │ Firm booking notice        │ —                                  │ —                                                  │ Calendly → /webhooks/calendly
Click upload link in email,       │ Firm "Upload" notice       │ —                                  │ uploaded:{sid}; renews session-matter:{sid}        │ Zapier ATTACH + AUDIT
upload file (late upload)         │ + Client confirmation      │ (cancels pending reminder)         │ (cancels QStash reminder)                          │
24h reminder fires                │ —                          │ Client reminder SMS                │ sms-reminder-sent:{sid}                            │ —
Zap #1 tail → matter created      │ —                          │ —                                  │ session-matter:{sid} (TTL 90d)                     │ ←inbound: /webhooks/smokeball-matter-created
```

---

## 5. Known gaps / things to flag in the demo

1. **Real-Stripe webhook does not send SMS.** Confirmed in [src/app/api/webhooks/stripe/route.ts](src/app/api/webhooks/stripe/route.ts) — only emails fire. The `handleIntakePaid()` orchestrator (with full SMS fan-out) is wired into the **demo bypass** route only. Stop me before the demo if SMS-on-real-payment is required.
2. **Zap #1 (Smokeball matter create) is not in the codebase.** It must be configured externally in Zapier (likely triggered by the firm-lead or firm-transcript email). Without it, both late uploads *and* in-chat uploads arrive at Zapier with `smokeball_matter_id: null` and require manual reconciliation.
3. **In-chat uploads can race Zap #1.** When the user uploads files in-chat seconds after payment, the Smokeball matter mapping (`session-matter:{sessionId}`) likely hasn't been captured yet. ATTACH zap payloads will have `smokeball_matter_id: null`. Zapier-side handling (queue / retry / manual flag) decides whether the file lands in the right matter.
4. **`.env.example` has stale env names** (`FIRM_NOTIFICATION_EMAIL`, `URGENT_SMS_RECIPIENT`, plus `ZAPIER_WEBHOOK_URL` / `ZAPIER_DEV_WEBHOOK_URL` which are no longer referenced). The code reads `FIRM_NOTIFY_EMAIL` and `FIRM_NOTIFY_PHONE`. If your `.env.local` was copied from the example, the urgent firm SMS and most firm emails will silently no-op.
5. **`CALENDLY_BOOKING_URL` (server) vs. `NEXT_PUBLIC_CALENDLY_BOOKING_URL` (client embed)** — different env vars. Both fall back to `https://calendly.com/ekalaivan/advising-meeting` in code. Set both to the firm's real Calendly URL for the demo (the `NEXT_PUBLIC_` one needs to be present at *build* time on Vercel, not just runtime — redeploy after adding it).
6. **Calendly `eventStartTime`** in the inline-widget callback is hardcoded `""` ([calendly-embed.tsx:59](src/components/booking/calendly-embed.tsx)) — only the firm-side webhook email gets the real start time. Not a bug per se, but worth knowing if you demo "what time did they book" in chat.
