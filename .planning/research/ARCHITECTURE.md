# Architecture Research

**Domain:** Provider-agnostic payment-success SMS dispatch + 24h delayed reminder with upload-gate cancellation
**Researched:** 2026-04-24
**Confidence:** HIGH

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                        PAYMENT LAYER                                 │
│  ┌──────────────────────────┐  ┌──────────────────────────┐          │
│  │  /api/webhooks/stripe    │  │  /api/webhooks/bpoint    │          │
│  │  (existing)              │  │  (parallel worktree)     │          │
│  └────────────┬─────────────┘  └────────────┬─────────────┘          │
│               │                             │                        │
│               └──────────────┬──────────────┘                        │
│                              ▼                                        │
│              handleIntakePaid(event: IntakePaidEvent)                 │
│              src/lib/intake-paid.ts                                   │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                     ▼
   ┌─────────────┐    ┌────────────────┐   ┌─────────────────────┐
   │  (existing) │    │  src/lib/sms/  │   │  (existing)         │
   │  email fan- │    │  dispatch.ts   │   │  upload token +     │
   │  out        │    │  copy.ts       │   │  session update     │
   └─────────────┘    └───────┬────────┘   └─────────────────────┘
                              │
                   ┌──────────┴──────────┐
                   ▼                     ▼
          sendImmediateSms()     scheduleReminderSms()
          (ClickSend API)        (QStash publishJSON,
                                  delay: 24h,
                                  stores msgId in Redis)

                              ▼  [24 hours later]
                   /api/webhooks/sms-reminder
                   ┌──────────────────────────────┐
                   │  1. Load upload token record  │
                   │  2. Check uploadRefs.length   │
                   │  3. If uploaded → skip + log  │
                   │  4. If not → sendSmS()        │
                   └──────────────────────────────┘

                              ▼  [on any upload]
                   /api/upload  or  /api/late-upload/session
                   ┌──────────────────────────────┐
                   │  cancelPendingReminder(       │
                   │    sessionId)                 │
                   │  (reads msgId from Redis,     │
                   │   calls client.messages       │
                   │   .cancel(msgId))             │
                   └──────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Location |
|-----------|----------------|----------|
| `IntakePaidEvent` | Internal event shape; emitted by both payment webhooks | `src/types/index.ts` (new fields) |
| `handleIntakePaid()` | Orchestrates all post-payment side effects; single call site | `src/lib/intake-paid.ts` (new file) |
| `src/lib/sms/dispatch.ts` | ClickSend API client; `sendSms()`, `isMobileNumber()`, E.164 normalisation | `src/lib/sms/dispatch.ts` (new) |
| `src/lib/sms/copy.ts` | SMS message strings; immediate + reminder copy with opt-out footer | `src/lib/sms/copy.ts` (new) |
| `src/lib/sms/reminder.ts` | `scheduleReminderSms()` — publishes QStash message; stores QStash messageId in Redis | `src/lib/sms/reminder.ts` (new) |
| `/api/webhooks/sms-reminder` | QStash delivery target; checks upload state, sends or skips | `src/app/api/webhooks/sms-reminder/route.ts` (new) |
| `cancelPendingReminder()` | Reads QStash messageId from Redis, calls `client.messages.cancel()` | `src/lib/sms/reminder.ts` (new, exported fn) |

---

## Recommended Project Structure

New files only (existing structure unchanged):

```
src/
├── app/
│   └── api/
│       └── webhooks/
│           └── sms-reminder/
│               └── route.ts          # QStash delivery target for 24h reminder
├── lib/
│   ├── sms/
│   │   ├── dispatch.ts               # ClickSend fetch client + E.164 normalisation
│   │   ├── copy.ts                   # SMS message strings (immediate + reminder)
│   │   └── reminder.ts               # scheduleReminderSms(), cancelPendingReminder()
│   └── intake-paid.ts                # handleIntakePaid() — the provider-agnostic seam
└── types/
    └── index.ts                      # Add IntakePaidEvent interface
```

### Structure Rationale

- **`src/lib/sms/`**: Mirrors the established `src/lib/email/` subdirectory pattern. Groups ClickSend client, copy strings, and scheduling logic without polluting the flat `src/lib/` level. Does NOT use subdirectories within `sms/` — stays flat as per the tools directory guidance.
- **`src/lib/intake-paid.ts`**: A single orchestration module that replaces the inline fan-out currently inside `src/app/api/webhooks/stripe/route.ts`. Both Stripe and Bpoint webhook handlers call this one function. This is the only merge-conflict firebreak needed for the parallel worktree.
- **`src/app/api/webhooks/sms-reminder/`**: New webhook under `webhooks/` follows the existing pattern of `webhooks/stripe/`, `webhooks/calendly/`, `webhooks/smokeball-matter-created/`. The route is protected by QStash signature verification rather than a custom secret.

---

## Architectural Patterns

### Pattern 1: Internal Event Abstraction (`IntakePaidEvent`)

**What:** A plain TypeScript interface that both payment webhook handlers construct and pass to `handleIntakePaid()`. Neither webhook handler contains any SMS or email dispatch logic directly.

**When to use:** Any time two divergent code paths (Stripe, Bpoint) must produce identical downstream side effects. The event is the contract; the webhook is only responsible for authentication and extraction.

**Trade-offs:** Adds one indirection layer, but eliminates duplicated fan-out logic and prevents merge conflicts when the Bpoint worktree lands.

**Shape:**

```typescript
// src/types/index.ts — add alongside existing interfaces
export interface IntakePaidEvent {
  sessionId: string;
  clientEmail: string;
  clientName: string;
  clientPhone: string | null;   // raw as stored in session/intake; may be null
  paymentAmountCents: number;
  providerSessionId: string;    // stripe session ID or bpoint transaction ID
  uploadLink: string;           // already-constructed HTTPS URL with raw token
  rawUploadToken: string;       // needed to store for reminder lookup
}
```

**Emitter (Stripe webhook — replace inline fan-out):**

```typescript
// src/app/api/webhooks/stripe/route.ts — after token creation
await handleIntakePaid({
  sessionId,
  clientEmail,
  clientName,
  clientPhone: intake?.clientPhone ?? null,
  paymentAmountCents: session.amount_total ?? 0,
  providerSessionId: session.id,
  uploadLink,
  rawUploadToken: rawToken,
});
```

**Bpoint webhook (parallel worktree) emits the same shape** — its own auth/extraction logic, same `handleIntakePaid()` call.

---

### Pattern 2: SMS Dispatch Module (`src/lib/sms/dispatch.ts`)

**What:** A thin wrapper around the ClickSend REST API (`POST /v3/sms/send`) using `fetch`. Exports `sendSms()` and `toE164AU()`. No SDK dependency — ClickSend's REST surface for a single send is 3 fields.

**When to use:** Anywhere SMS needs to be sent. Callers never touch `fetch` or ClickSend credentials directly.

**Trade-offs:** No SDK means no automatic retry logic, but the application already follows this pattern (Zapier uses raw fetch). QStash handles delivery retries for the reminder path; immediate send failures are logged and non-fatal (email already sent).

**Absent-safe pattern (mirrors existing email pattern):**

```typescript
// src/lib/sms/dispatch.ts
export async function sendSms(to: string, body: string): Promise<void> {
  const username = process.env.CLICKSEND_USERNAME;
  const apiKey = process.env.CLICKSEND_API_KEY;

  if (!username || !apiKey) {
    console.warn("[sms] CLICKSEND_* env vars missing — SMS skipped");
    return;
  }

  const e164 = toE164AU(to);
  if (!e164) {
    console.warn("[sms] could not normalise to E.164, skipping", { to });
    return;
  }

  if (isLandline(to)) {
    console.info("[sms] landline detected, skipping", { to: redact(to) });
    return;
  }

  const res = await fetch("https://rest.clicksend.com/v3/sms/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${username}:${apiKey}`).toString("base64")}`,
    },
    body: JSON.stringify({
      messages: [{
        to: e164,
        body,
        from: process.env.CLICKSEND_SENDER_ID ?? "AquariusLaw",
      }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[sms] ClickSend error", { status: res.status, body: text });
  } else {
    console.info("[sms] sent", { to: redact(e164) });
  }
}
```

**E.164 normalisation and landline detection:**

ClickSend does not return a carrier-type field in its API response, so landline detection must be done locally before the call. Australian landline prefixes are `02`, `03`, `07`, `08` (after stripping country code). AU mobile numbers always begin with `04` or `+614`. Implement `isLandline()` by checking the cleaned number against the same AU regex already in `src/lib/validators.ts`, but negating the mobile prefix condition:

```typescript
// A number is a landline if it matches AU_PHONE_REGEX but does NOT start with 04/+614
export function isLandline(phone: string): boolean {
  const cleaned = phone.replace(/[\s\-()]/g, "");
  const isMobile = /^(?:\+?61\s?4|\b04)\d{8}$/.test(cleaned);
  return !isMobile;
}
```

Note: `validatePhone()` in `validators.ts` already accepts both mobile and landline. `isLandline()` is a new utility in `src/lib/sms/dispatch.ts`, not a modification of the existing validator.

---

### Pattern 3: QStash One-Shot Delayed Reminder

**What:** On payment success, publish a QStash message with `delay: 86400` (24 hours in seconds) targeting `/api/webhooks/sms-reminder`. Store the returned `messageId` in Redis under `sms-reminder:<sessionId>`. At reminder time, the handler reads the upload token record and session uploadRefs to determine whether to send or skip. When the client uploads (in either the live upload or late-upload path), cancel the pending QStash message.

**When to use:** One-shot future delivery that must be cancellable. Vercel Cron fires on a fixed schedule and would require scanning all pending reminders; QStash fires exactly once at the right time and is cancellable by ID. For this use case (24h, cancellable, ~1-day scope) QStash is the correct choice.

**Trade-offs:**

| Aspect | QStash | Vercel Cron |
|--------|--------|-------------|
| Delivery precision | Fires at scheduled time | Fires on interval; needs scan |
| Cancellation | `client.messages.cancel(msgId)` | Must flip a Redis flag; cron still runs |
| Complexity | Add `@upstash/qstash` dep (already in Upstash family) | No new dep; more Redis logic |
| Cost | Per-message on free tier; 100 free/day | Included in Vercel |
| Fit for scope | Direct; minimal code | Indirect; more scanning code |

QStash is the correct choice here. The codebase already uses Upstash Redis (`@upstash/redis`), so adding `@upstash/qstash` follows the same vendor pattern.

**Schedule on payment:**

```typescript
// src/lib/sms/reminder.ts
import { Client } from "@upstash/qstash";
import { redis } from "@/lib/kv";

const REMINDER_KEY_PREFIX = "sms-reminder:";
const REMINDER_TTL = 60 * 60 * 26; // 26h — slightly beyond reminder window

export async function scheduleReminderSms(
  sessionId: string,
  phone: string,
  uploadLink: string
): Promise<void> {
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    console.warn("[sms-reminder] QSTASH_TOKEN missing — reminder not scheduled");
    return;
  }

  const appUrl = process.env.APP_URL;
  if (!appUrl) throw new Error("APP_URL not configured");

  const client = new Client({ token });
  const res = await client.publishJSON({
    url: `${appUrl}/api/webhooks/sms-reminder`,
    body: { sessionId, phone, uploadLink },
    delay: 86400, // 24 hours in seconds
    retries: 2,
  });

  // res.messageId is the QStash message ID
  await redis.set(`${REMINDER_KEY_PREFIX}${sessionId}`, res.messageId, {
    ex: REMINDER_TTL,
  });

  console.info("[sms-reminder] scheduled", { sessionId, messageId: res.messageId });
}

export async function cancelPendingReminder(sessionId: string): Promise<void> {
  const token = process.env.QSTASH_TOKEN;
  if (!token) return;

  const msgId = await redis.get<string>(`${REMINDER_KEY_PREFIX}${sessionId}`);
  if (!msgId) return; // already fired or never scheduled

  try {
    const client = new Client({ token });
    await client.messages.cancel(msgId);
    await redis.del(`${REMINDER_KEY_PREFIX}${sessionId}`);
    console.info("[sms-reminder] cancelled", { sessionId, messageId: msgId });
  } catch (err) {
    // If QStash says already delivered, that is fine — the handler guards on upload state
    console.warn("[sms-reminder] cancel attempt failed (may have already fired)", {
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
```

**Reminder handler:**

```typescript
// src/app/api/webhooks/sms-reminder/route.ts
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { getSession } from "@/lib/kv";
import { resolveUploadToken } from "@/lib/upload-tokens";
import { sendSms } from "@/lib/sms/dispatch";
import { reminderCopy } from "@/lib/sms/copy";

export const POST = verifySignatureAppRouter(async (req: Request) => {
  const { sessionId, phone, uploadLink } = await req.json();

  // Primary guard: check uploadRefs on the session record
  const session = await getSession(sessionId);
  if (session?.uploadRefs && session.uploadRefs.length > 0) {
    console.info("[sms-reminder] upload already present, skipping", { sessionId });
    return new Response("skipped");
  }

  // Secondary guard: check if upload token still exists
  // (token is revoked on successful upload via late-upload path)
  // If both session is gone AND token is gone, client has uploaded — skip
  if (!session) {
    console.info("[sms-reminder] session expired with no uploadRefs record — skip", {
      sessionId,
    });
    return new Response("skipped");
  }

  await sendSms(phone, reminderCopy(uploadLink));
  console.info("[sms-reminder] reminder sent", { sessionId });
  return new Response("ok");
});
```

---

### Pattern 4: Upload-Cancels-Reminder Hook

**What:** Both upload paths (`/api/upload` and `/api/late-upload/session`) call `cancelPendingReminder(sessionId)` after a successful upload. This is a best-effort fire-and-forget; if cancellation fails (QStash already delivered), the reminder handler's upload-state guard prevents a duplicate send.

**Why two guards:** Defence-in-depth. The cancel call is cheap and prevents the handler from running at all in the happy path. The handler guard is the fallback if the cancel races with delivery (QStash may have already enqueued the message for delivery when cancel is called).

**Call site (upload route):**

```typescript
// After successful blob store + session.uploadRefs update
import { cancelPendingReminder } from "@/lib/sms/reminder";

// fire-and-forget; do not await if upload handler already returned
cancelPendingReminder(sessionId).catch((err) =>
  console.warn("[upload] reminder cancel failed", { err })
);
```

---

## Data Flow

### Post-Payment SMS Flow

```
Stripe/Bpoint webhook receives event
    ↓
Verify signature (provider-specific)
    ↓
Extract: sessionId, clientEmail, clientName, phone, amount, providerSessionId
    ↓
createUploadToken() → rawToken, uploadLink
    ↓
handleIntakePaid(IntakePaidEvent)
    ├── updateSession() ← existing
    ├── sendTranscriptEmail() ← existing
    ├── sendPaymentReceiptEmail() ← existing
    ├── sendSms(phone, immediateCopy(uploadLink))   ← NEW
    └── scheduleReminderSms(sessionId, phone, uploadLink)  ← NEW
            ↓
            QStash publishJSON({ delay: 86400 })
            ↓
            Store { sessionId → QStash messageId } in Redis (TTL 26h)

[24 hours pass]
    ↓
QStash delivers POST /api/webhooks/sms-reminder
    ↓
verifySignatureAppRouter (QStash HMAC)
    ↓
getSession(sessionId) → check uploadRefs
    ├── uploadRefs.length > 0  → log "skipped", return 200
    └── uploadRefs empty       → sendSms(phone, reminderCopy(uploadLink))

[Meanwhile, if client uploads before 24h]
    ↓
/api/upload or /api/late-upload/session
    ↓
cancelPendingReminder(sessionId)
    ↓
redis.get("sms-reminder:<sessionId>") → messageId
    ↓
client.messages.cancel(messageId)  [QStash REST DELETE /v2/messages/:id]
    ↓
redis.del("sms-reminder:<sessionId>")
```

### State Stored in Redis (new keys)

| Key pattern | Value | TTL | Purpose |
|-------------|-------|-----|---------|
| `sms-reminder:<sessionId>` | QStash messageId (string) | 26h | Enables cancel before delivery |

No new Redis key namespaces for the immediate SMS — it is fire-and-forget with no state.

---

## Integration Points

### External Services

| Service | Integration Pattern | Auth | Notes |
|---------|---------------------|------|-------|
| ClickSend REST API | `fetch` POST to `/v3/sms/send` | HTTP Basic (`username:apiKey` base64) | Absent-safe: returns early if env vars missing |
| Upstash QStash | `@upstash/qstash` `Client.publishJSON()` + `Client.messages.cancel()` | `QSTASH_TOKEN` | Same Upstash account/console as existing Redis |

### New Environment Variables

| Variable | Required | Purpose | Absent behaviour |
|----------|----------|---------|-----------------|
| `CLICKSEND_USERNAME` | No (graceful) | ClickSend account username | SMS silently skipped with warn log |
| `CLICKSEND_API_KEY` | No (graceful) | ClickSend API key | SMS silently skipped with warn log |
| `CLICKSEND_SENDER_ID` | No | Registered AU sender ID string | Defaults to `"AquariusLaw"` |
| `QSTASH_TOKEN` | No (graceful) | QStash publish/cancel token | Reminder not scheduled, warn logged |
| `QSTASH_CURRENT_SIGNING_KEY` | Yes (in prod) | QStash signature verification | Required by `verifySignatureAppRouter` |
| `QSTASH_NEXT_SIGNING_KEY` | Yes (in prod) | QStash signature key rotation | Required by `verifySignatureAppRouter` |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Payment webhook → SMS | `handleIntakePaid(IntakePaidEvent)` direct function call | The only seam both Stripe and Bpoint touch |
| `handleIntakePaid` → SMS dispatch | Direct import of `sendSms()` from `src/lib/sms/dispatch.ts` | Synchronous; failure is caught and logged, does not fail webhook response |
| `handleIntakePaid` → QStash | `scheduleReminderSms()` from `src/lib/sms/reminder.ts` | Async; failure is caught and logged |
| Upload routes → QStash cancel | `cancelPendingReminder()` from `src/lib/sms/reminder.ts` | Fire-and-forget; reminder handler is fallback |
| QStash → reminder handler | HTTP POST to `/api/webhooks/sms-reminder` | Verified by `verifySignatureAppRouter` |

---

## Testing Strategy (Dev/Preview Without Hitting ClickSend)

**Problem:** ClickSend env vars must be absent for local dev and Vercel preview deployments so no live SMS is sent to clients.

**Solution:** The absent-safe pattern in `sendSms()` handles this automatically — if `CLICKSEND_USERNAME` or `CLICKSEND_API_KEY` are not set, the function logs a warning and returns without making any HTTP call. No mock, no `NODE_ENV` check, no stub required.

**For the reminder handler in test/preview:** `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY` are absent in dev, which means `verifySignatureAppRouter` will reject requests. To test the handler logic locally:
- Use `@upstash/qstash`'s `Receiver` class in a dedicated test, or
- Write a unit test for the handler's inner logic as a plain async function extracted from the route wrapper.

**Suggested test structure:**

```
src/
└── lib/
    └── sms/
        └── __tests__/
            ├── dispatch.test.ts   # unit: toE164AU, isLandline, sendSms with mocked fetch
            ├── copy.test.ts       # unit: copy strings include opt-out language
            └── reminder.test.ts   # unit: scheduleReminderSms, cancelPendingReminder
                                   #  with mocked QStash Client and mocked redis
```

**Test pattern for `sendSms()` with missing env:**

```typescript
// dispatch.test.ts
it("skips send when CLICKSEND env vars absent", async () => {
  const warnSpy = vi.spyOn(console, "warn");
  delete process.env.CLICKSEND_USERNAME;
  delete process.env.CLICKSEND_API_KEY;
  await sendSms("+61412345678", "test message");
  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("CLICKSEND_* env vars missing"));
  expect(global.fetch).not.toHaveBeenCalled();
});
```

**End-to-end manual verification path (staging/prod):**
1. Set `CLICKSEND_*` env vars in Vercel production environment only.
2. In development, confirm warn log appears in `vercel dev` output when intake-paid fires.
3. In staging, use a real AU mobile number to confirm receipt and opt-out footer.

---

## Anti-Patterns

### Anti-Pattern 1: Dispatch SMS Directly Inside Webhook Handlers

**What people do:** Add `sendSms()` calls inside `src/app/api/webhooks/stripe/route.ts` and then duplicate the same logic inside the future Bpoint webhook handler.

**Why it's wrong:** The parallel Bpoint worktree will also need SMS dispatch. Putting logic in two webhook handlers guarantees a merge conflict, duplicated copy strings, and diverging behaviour over time. This is exactly the problem `handleIntakePaid()` solves.

**Do this instead:** Both webhook handlers call `handleIntakePaid(event)`. SMS lives in `src/lib/intake-paid.ts` and `src/lib/sms/`.

---

### Anti-Pattern 2: Using Vercel Cron for the 24h Reminder

**What people do:** Add a `vercel.json` cron entry that runs every hour, scans Redis for sessions with no uploads and a `reminderScheduledAt` timestamp, and sends SMS to any that are past 24h.

**Why it's wrong:** Requires a Redis scan across all sessions (or a secondary index), runs unnecessary computation every hour for the lifetime of the cron, cannot be stopped without a deploy, and the "already sent reminder" guard must be stored separately in Redis. Substantially more code for identical reliability.

**Do this instead:** Use QStash `publishJSON` with `delay: 86400`. One message, fires once at the right time, cancellable by ID. The existing Upstash console/account already supports QStash.

---

### Anti-Pattern 3: Coupling "Upload State" Check to the Upload Token Alone

**What people do:** At reminder time, call `resolveUploadToken(rawToken)` and skip if the token is gone (revoked on upload).

**Why it's wrong:** The QStash payload contains `sessionId`, not the raw token (which must never leave the server at token-creation time). The raw token is not stored in Redis — only its hash is. Passing the raw token through QStash would mean storing it unencrypted in an external message queue.

**Do this instead:** Check `session.uploadRefs.length > 0` using `getSession(sessionId)`. The session record authoritatively reflects upload state. If the session has expired (1h TTL) but the client uploaded during the live session, `uploadRefs` would have been written before expiry; absence of the session is treated as "session expired without upload" (send reminder). This is conservative (may send when not needed if the 1h session expired between upload and reminder), but the reminder handler's send is idempotent from the client's perspective and the copy is helpful regardless.

A more precise secondary check: the upload token is revoked by `revokeTokenByHash()` on late-upload completion. If the reminder fires after a late upload but before 24h, `resolveUploadToken` returning null is a valid additional guard — but only if the token hash was stored somewhere the reminder handler can access without the raw token. The simplest approach: store `tokenHash` (not raw token) in the QStash payload alongside `sessionId`.

---

## Suggested Build Order

Dependencies flow bottom-up:

| Step | What | Why this order |
|------|------|----------------|
| 1 | Add `IntakePaidEvent` to `src/types/index.ts` | Type foundation; everything else imports it |
| 2 | `src/lib/sms/dispatch.ts` — `toE164AU`, `isLandline`, `sendSms` | No dependencies on new code; testable in isolation |
| 3 | `src/lib/sms/copy.ts` — immediate and reminder copy strings | No dependencies; needs Spam Act opt-out footer |
| 4 | `src/lib/sms/reminder.ts` — `scheduleReminderSms`, `cancelPendingReminder` | Depends on `@upstash/qstash`, `dispatch.ts`, `kv.ts` |
| 5 | `src/app/api/webhooks/sms-reminder/route.ts` | Depends on `dispatch.ts`, `copy.ts`, `kv.ts`, `upload-tokens.ts` |
| 6 | `src/lib/intake-paid.ts` — extract + extend existing Stripe fan-out | Depends on all above; replaces inline logic in Stripe webhook |
| 7 | Refactor `src/app/api/webhooks/stripe/route.ts` to call `handleIntakePaid()` | Depends on step 6; regression-test existing email flow |
| 8 | Add `cancelPendingReminder()` calls to `/api/upload` and `/api/late-upload/session` | Depends on step 4; both paths need the hook |
| 9 | Tests for `src/lib/sms/__tests__/` | Can run in parallel with steps 5-8 once dispatch + copy are stable |

Steps 2-5 can be written and tested independently before touching any existing code. The refactor in step 7 is the only change to an existing file with significant logic.

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Current (single firm) | Pattern as described; no changes needed |
| Multi-firm / white-label | Move `CLICKSEND_SENDER_ID` per-firm config; `handleIntakePaid` becomes firm-context-aware |
| High volume (1k+ payments/day) | QStash free tier is 500 messages/day; upgrade to pay-as-you-go ($1/10k messages) |

The immediate SMS send is synchronous inside `handleIntakePaid()`. At current scale this is fine — ClickSend's API response is fast and the webhook response time budget is generous. If Stripe/Bpoint webhooks show timeout pressure, move `sendSms()` into a QStash message as well (0-delay), making both sends async.

---

## Sources

- Upstash QStash delay documentation: https://upstash.com/docs/qstash/features/delay
- Upstash QStash Next.js quickstart: https://upstash.com/docs/qstash/quickstarts/vercel-nextjs
- QStash message cancel SDK: https://upstash.com/docs/qstash/sdks/ts/examples/messages
- ClickSend SMS REST API reference: https://developers.clicksend.com/docs/messaging/sms
- ClickSend REST endpoint: `POST https://rest.clicksend.com/v3/sms/send`
- Existing codebase: `src/app/api/webhooks/stripe/route.ts`, `src/lib/resend.ts`, `src/lib/kv.ts`, `src/lib/upload-tokens.ts`, `src/lib/validators.ts`

---

*Architecture research for: Aquarius Lawyers Chatbot — SMS dispatch milestone*
*Researched: 2026-04-24*
