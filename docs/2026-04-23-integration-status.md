# Integration Status — 2026-04-23 (Post-Client-Meeting)

**Purpose:** Single source of truth for what's wired up, what's deferred, and what the
weekend code queue looks like before Monday's demo.

**Demo date:** Monday 2026-04-27
**Demo URL:** `https://aquarius-chatbot.vercel.app` (agency Vercel — migration to
Aquarius's org is a pre-launch task, not a demo blocker)
**Upstream docs:**
- Design: [`superpowers/specs/2026-04-22-urgent-sms-and-bpoint-payment-design.md`](./superpowers/specs/2026-04-22-urgent-sms-and-bpoint-payment-design.md)
- Meeting agenda + post-meeting recap: [`2026-04-23-client-meeting-agenda.md`](./2026-04-23-client-meeting-agenda.md)

---

## 1. Credentials — what's in `.env.local`

| Service | Captured | Notes |
|---|---|---|
| OpenRouter (LLM) | ✅ pre-existing | No change |
| Resend | ✅ | `marketing@aquariuslawyers.com.au` as sender + firm-notify (domain already verified) |
| ClickSend | ✅ username + API key | Sender ID blank — falls back to ClickSend shared number until `AquariusLaw` alpha tag approves (~1–2 business days) |
| `URGENT_SMS_RECIPIENT` | ✅ `+61450533474` | Single solicitor number, per meeting decision |
| BPoint | ✅ API user + merchant + biller | SCI role; sandbox endpoint works with prod creds. `BPOINT_ENV=sandbox` for dev. |
| Calendly PAT | ✅ | Scopes: `users:read`, `webhooks:read`, `webhooks:write`, `scheduled_events:read` |
| Calendly webhook signing key | ✅ | Generated client-side (`openssl rand -hex 32`), supplied to Calendly at subscription creation. Subscription UUID `dca8e625-b160-4e81-9a7b-99306754b12f` |
| `SMOKEBALL_CAPTURE_SECRET` | ✅ | `openssl rand -base64 32`. Mirrors into Zap #1's tail step as `X-Smokeball-Capture-Secret` header |
| `UPLOAD_COOKIE_SECRET` / `CRON_SECRET` | ✅ pre-existing | No change |
| Upstash Redis | ⏸ agency instance | Same URL/token; migrate to Aquarius instance post-demo |
| Vercel Blob | ✅ pre-existing | Agency token; same migration deferral |
| Stripe | ⚠ deprecated | Keys retained during BPoint soak; removed after 1 clean prod week |

**Not in `.env.local` (prod-only, lives in Vercel):**
- `ZAPIER_WEBHOOK_URL` = Zap #1 prod URL (`…/ujx0819/`) — **must** be set in Vercel Production env, never locally
- `ZAPIER_DEV_WEBHOOK_URL` — optional; leave blank in Vercel

Local dev points `ZAPIER_WEBHOOK_URL` at **Zap #4** (`…/ujp9qvr/`) so nothing dev can
reach Smokeball even if every other safeguard fails.

---

## 2. Zapier wiring

Four Zaps. The first three live in production; the fourth is the dev tripwire.

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Zap #1 (PROD)  ujx0819                                                    │
│   Trigger: Catch Hook  →  Filter (isTest ≠ true)  →  Smokeball Create      │
│   Matter (Matter Type = "Criminal General", Use Existing Client = False)  │
│   →  Webhooks by Zapier POST /api/webhooks/smokeball-matter-created       │
│       body: { sessionId, smokeballMatterId }                              │
│       header: X-Smokeball-Capture-Secret: <SMOKEBALL_CAPTURE_SECRET>      │
│   Status: ✅ published, end-to-end tested (test matter created + deleted) │
├───────────────────────────────────────────────────────────────────────────┤
│ Zap #2 (PROD)  e2kcqq                                                     │
│   Trigger: Catch Hook  →  Filter (isTest ≠ true)  →  Smokeball Upload     │
│   File to Matter (Matter ID = dynamic, sourced from capture-back Redis)   │
│   Status: 🟡 URL captured, action design in progress. Payload shape frozen │
│   per src/lib/late-upload/handle-completed.ts (matter_ref, client_email,  │
│   client_name, file{url,name,content_type,size_bytes}, uploaded_at,       │
│   source).                                                                │
├───────────────────────────────────────────────────────────────────────────┤
│ Zap #3 (PROD)  ujp4wvd                                                    │
│   Trigger: Catch Hook  →  (action TBD — Google Sheet append or email)    │
│   Status: 🟡 URL captured, action deferred post-demo (durable audit log)  │
├───────────────────────────────────────────────────────────────────────────┤
│ Zap #4 (DEV)   ujp9qvr                                                    │
│   Trigger: Catch Hook  →  Email prabu@motionify.co with full payload      │
│   No filter, no Smokeball action — physically cannot pollute prod.        │
│   Status: ✅ published                                                    │
└───────────────────────────────────────────────────────────────────────────┘
```

### Anti-pollution design (defence in depth)

Three independent safeguards, each sufficient on its own:

1. **URL split by env.** Dev machines set `ZAPIER_WEBHOOK_URL=…/ujp9qvr/`; Vercel Production
   sets it to `…/ujx0819/`. A dev POST cannot reach the Smokeball Zap by URL alone.
2. **Filter step on every prod Zap.** "Only continue if `isTest` is false OR does not
   exist." Even if a dev payload reached the prod URL, the filter blocks it.
3. **Naming convention.** Test payloads use conspicuous names (e.g. `BLOCKED DoNotCreate`,
   `Filter SampleV4`) so any leak is instantly recognisable in Smokeball.

**Field-binding gotcha (learned the hard way):** Zapier's field picker silently
misbinds nested keys. `meta.testPayload` showed the ⚠ warning and the filter treated
"does not exist" as true → Smokeball ran. Fix: flatten to a top-level `isTest`
boolean. Don't nest safety-critical flags.

---

## 3. Architectural decisions made today

### 3.1 Dev/Prod Zap split + `isTest` filter
See above. Two-URL pattern is the primary safeguard; filter is the backstop.

### 3.2 Session → Smokeball matter mapping via capture-back (Path 1)

**Problem:** Zap #2 (late upload) needs the Smokeball matter ID to attach a file, but
our app only knows the Stripe/BPoint `sessionId`. Smokeball doesn't push IDs back.

**Chosen path:** capture-back via Zap #1's tail webhook.

```
┌──────────────┐   payment ok   ┌──────────┐  intake+pmt   ┌───────────────┐
│   Chatbot    ├───────────────▶│  Zap #1  ├──────────────▶│   Smokeball   │
│ (POST Zap #1)│                │          │               │ (creates matter│
└──────────────┘                └────┬─────┘               │  returns id)  │
                                     │                     └───────────────┘
                                     │ tail webhook
                                     ▼
                     POST /api/webhooks/smokeball-matter-created
                     body: { sessionId, smokeballMatterId }
                     header: X-Smokeball-Capture-Secret
                                     │
                                     ▼
                         Redis: session-matter:{sessionId} = {matterId}
                                                               TTL 90 days
                                     │
                                     ▼
                  later, when client uploads late file:
                  /api/late-upload/* reads matterId from Redis
                  and POSTs to Zap #2 with correct matter_ref
```

**Why Path 1 (not Path 2 "collect all docs in chat" or Path 3 "direct Smokeball API"):**
- Path 2 breaks UX — clients don't have docs ready during intake
- Path 3 requires Smokeball API access Julie hasn't enabled (Zapier-only today)
- Path 1 keeps Zapier as the single integration surface and adds one small capture endpoint

**TTL = 90 days.** Covers realistic late-upload window for criminal matters; Redis key
renewed on every successful upload.

### 3.3 Top-level `isTest` boolean
Not `meta.testPayload`. See field-binding gotcha in §2.

---

## 4. Monday demo flow (what Julie will see)

1. Client opens `aquarius-chatbot.vercel.app` → chatbot intake
2. Chatbot collects matter summary, triages urgency
3. If urgent → ClickSend SMS to `+61450533474` (*"URGENT — Aquarius chatbot intake…"*)
4. Payment step → BPoint sandbox (shows real UI flow; `$0.01` test txn)
5. On payment success → POST to Zap #1 → Smokeball matter created → session→matter
   mapping captured back to Redis → client confirmation email via Resend
6. Optional: demo late-upload magic-link flow (Zap #2)
7. Optional: demo Calendly booking → webhook fires → booking confirmation email

**Fallbacks built in:**
- ClickSend alpha tag not approved → numeric sender
- BPoint Iframe Fields not enabled → UI mockup + talk through the flow
- Calendly webhook not firing → embed still works, narrate missing post-booking automation

---

## 5. Weekend code queue

Ordered by risk / dependency.

- [ ] **`src/app/api/webhooks/smokeball-matter-created/route.ts`** — capture-back endpoint
  - Verify `X-Smokeball-Capture-Secret` header against `SMOKEBALL_CAPTURE_SECRET`
  - Write `session-matter:{sessionId}` → `{ smokeballMatterId, capturedAt }` with 90d TTL
  - Return 200 quickly; log + 401 on secret mismatch
- [ ] **`src/lib/session-matter-map.ts`** — Redis helper
  - `setMatterForSession(sessionId, matterId)`
  - `getMatterForSession(sessionId): Promise<string | null>`
  - `touchMatterForSession(sessionId)` — renew TTL on use
- [ ] **Update `src/lib/late-upload/handle-completed.ts`**
  - Resolve `matterRef` from `getMatterForSession(sessionId)` instead of argument
  - Fall back to firm-notify-only if mapping missing (don't fail hard)
- [ ] **BPoint integration code** (per design spec)
  - `src/lib/bpoint/client.ts` (ProcessPayment, sandbox/prod switch)
  - `src/app/api/bpoint/checkout/route.ts` — replaces Stripe checkout session
  - Iframe Fields component (gated on Julie's CBA confirmation)
- [ ] **ClickSend urgent-SMS wiring** (per design spec)
  - `src/lib/clicksend.ts` with `sendUrgentSms()`
  - Hook into intake triage path: if `urgency === "urgent"` fire SMS
- [ ] **Smoke test end-to-end** on agency Vercel Preview before Monday

---

## 6. User action items (Julie / Aquarius side)

- [ ] Ring CBA Merchant Services → confirm **BPoint Iframe Fields** is enabled on the
      facility (SCI is enabled; Iframe Fields is a separate config flag)
- [ ] Ping when ClickSend alpha sender ID `AquariusLaw` is approved — will flip
      `CLICKSEND_SENDER_ID` in Vercel prod env
- [ ] Smokeball field mapping (reply by Thursday or defaults ship):
  - Which field receives the urgency tag?
  - Which field receives the BPoint receipt number (Trust Accounting reconciliation)?
  - Which field receives the matter description?
- [ ] Post-Monday: invite me to Aquarius's Vercel + Upstash orgs → migration PR
- [ ] Delete leftover test matters from Smokeball: `ff3b6e2c-…`, `BLOCKED DoNotCreate`,
      `Filter SampleV4`

---

## 7. Known unknowns heading into the weekend

- **BPoint Iframe Fields** — if not enabled, Monday shows the flow as mockup and we
  book a CBA ticket. Not a show-stopper.
- **Smokeball field names for custom fields** — Zap #1 posts into sensible defaults
  (Matter Description, Notes); Julie can rewire after Thursday without code change.
- **ClickSend sender ID approval timing** — numeric fallback works for Monday; cosmetic.
- **Calendly webhook signing verification in code** — handler exists, signing key now
  captured; need to wire verification into the existing route before demo.
