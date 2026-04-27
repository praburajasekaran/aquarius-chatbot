---
phase: 2
slug: qstash-scheduler
status: complete
created: 2026-04-27
---

# Phase 2 — Discussion Context

> Implementation decisions captured during discuss-phase. Consumed by researcher and planner.

---

## Decisions

### 1. Upload-State Guard in Reminder Handler

**Decision:** Durable `uploaded:{sessionId}` Redis flag — Phase 2 handler reads it; Phase 3 upload routes write it.

**Why:** Session TTL is 1 hour (`SESSION_TTL = 3600` in `kv.ts`). The reminder fires at 24 hours. By the time QStash delivers the POST, `getSession(sessionId)` always returns `null` — the ARCHITECTURE.md's primary guard (`session.uploadRefs.length > 0`) would never skip in production. Upload token records persist for 7 days but `revokeTokenByHash` is never called on upload, so token existence also cannot signal "uploaded."

**Contract (Phase 2 defines; Phase 3 fulfils):**
```typescript
// Reminder handler (Phase 2) — reads the flag
const uploaded = await redis.get<string>(`uploaded:${sessionId}`);
if (uploaded) return new Response("skipped");

// Upload routes (Phase 3) — write the flag on successful upload
await redis.set(`uploaded:${sessionId}`, "1", { ex: 26 * 3600 });
```

**Redis key:** `uploaded:{sessionId}` — string `"1"`, TTL 26h (slightly beyond reminder window).

**Implication for ROADMAP success criteria SC4:** The test that verifies the handler returns `"skipped"` must mock `redis.get("uploaded:*")` returning `"1"` — NOT `getSession()` returning a session with `uploadRefs`. Update the test to match this contract.

---

### 2. Phone Number PII in QStash Payload

**Decision:** Store `{ sessionId, phone, uploadLink }` directly in the QStash message body.

**Why:** Upstash is already trusted infrastructure (same account/console as the existing Redis). Adding a second Redis key just to keep phone out of the QStash payload adds complexity with no meaningful privacy benefit. The phone number is already in Upstash Redis.

**QStash payload shape:**
```typescript
{ sessionId: string; phone: string; uploadLink: string }
```

---

### 3. Reminder Handler Test Strategy

**Decision:** Extract inner handler logic as a named export (`handleReminderDelivery`); wrap with `verifySignatureAppRouter` for the route's `POST` export. Unit tests import the inner function directly.

**Why:** `verifySignatureAppRouter` is a Next.js HOC that requires valid QStash signing keys to pass. Making the inner function testable without mocking the entire HOC is cleaner and tests the actual business logic.

**Route structure:**
```typescript
// src/app/api/webhooks/sms-reminder/route.ts
export async function handleReminderDelivery(req: Request): Promise<Response> {
  const { sessionId, phone, uploadLink } = await req.json();
  const uploaded = await redis.get<string>(`uploaded:${sessionId}`);
  if (uploaded) return new Response("skipped");
  await sendSms(phone, REMINDER_SMS_COPY(uploadLink));
  return new Response("ok");
}

export const POST = verifySignatureAppRouter(handleReminderDelivery);
```

**Test imports:**
```typescript
// src/lib/sms/__tests__/reminder.test.ts
import { handleReminderDelivery } from "@/app/api/webhooks/sms-reminder/route";
```

---

## Code Context

### Reusable Assets (existing, do not modify in Phase 2)

| Asset | Location | Notes |
|-------|----------|-------|
| `redis` singleton | `src/lib/kv.ts:4` | `Redis` from `@upstash/redis`; imported directly |
| `getSession()` | `src/lib/kv.ts:38` | Returns `SessionData \| null`; sessions expire in 1h |
| `sendSms()` | `src/lib/sms/dispatch.ts` | Phase 1 output; absent-safe |
| `REMINDER_SMS_COPY` | `src/lib/sms/copy.ts` | Phase 1 output; `(uploadLink: string) => string` |
| `@upstash/redis` | Already installed | Use existing `redis` export from `kv.ts` |
| Stripe dedup TTL | `src/app/api/webhooks/stripe/route.ts:11` | `DEDUPE_TTL_SECONDS = 60 * 60 * 24 * 7` (7 days) |
| `stripe-session:{sessionId}` key | Written in stripe webhook | Contains tokenHash (string) after token creation; `"pending"` before |

### New Dependency

- `@upstash/qstash` — not yet installed. Install as production dependency (used at runtime in `reminder.ts`).
- Provides: `Client` (from `@upstash/qstash`), `verifySignatureAppRouter` (from `@upstash/qstash/nextjs`)

### Existing Redis Key Namespaces (do not collide)

| Prefix | TTL | Owner |
|--------|-----|-------|
| `session:` | 1h | `kv.ts` |
| `stripe-session:` | 7d | stripe webhook |
| `upload-token:` | 7d | `upload-tokens.ts` |
| `sms-reminder:` | 26h | Phase 2 (new) |
| `uploaded:` | 26h | Phase 2 defines; Phase 3 writes |

### Upload Routes (Phase 3 will modify; Phase 2 must not touch)

| Route | Upload trigger | sessionId source |
|-------|----------------|------------------|
| `src/app/api/upload/route.ts` | Inline chat upload | `formData.get("sessionId")` |
| `src/app/api/late-upload/session/route.ts` | Authenticated post-payment upload | `session.sessionId` (from cookie) |

---

## Deferred Ideas

- Encrypting phone number in QStash payload (flagged for future privacy review if firm scales to multi-tenant)
- Moving immediate SMS send to a 0-delay QStash message (only needed if Stripe webhook timeout pressure arises)

---

*Context created: 2026-04-27*
*Phase 2 discuss-phase complete — ready for research and planning*
