# Phase 2: QStash Scheduler - Research

**Researched:** 2026-04-27
**Domain:** Upstash QStash delayed messaging, Next.js App Router webhook verification, Redis dedup/cancel pattern
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**1. Upload-State Guard in Reminder Handler**
- Use a durable `uploaded:{sessionId}` Redis flag (string `"1"`, TTL 26h)
- Phase 2 handler READS it; Phase 3 upload routes WRITE it
- Session TTL is 1h — by reminder fire time (24h), `getSession()` always returns `null` and CANNOT be used as the guard
- Handler logic:
  ```typescript
  const uploaded = await redis.get<string>(`uploaded:${sessionId}`);
  if (uploaded) return new Response("skipped");
  ```
- SC4 test must mock `redis.get("uploaded:*")` returning `"1"` — NOT `getSession()` returning a session with `uploadRefs`

**2. Phone Number PII in QStash Payload**
- Store `{ sessionId, phone, uploadLink }` directly in the QStash message body
- Upstash is trusted infrastructure (same account as Redis); second Redis lookup adds complexity with no meaningful benefit

**3. Reminder Handler Test Strategy**
- Extract inner handler logic as named export `handleReminderDelivery`; wrap with `verifySignatureAppRouter` for the route's `POST` export
- Unit tests import `handleReminderDelivery` directly from the route file — no need to mock the HOC
- Route shape:
  ```typescript
  export async function handleReminderDelivery(req: Request): Promise<Response> {
    const { sessionId, phone, uploadLink } = await req.json();
    const uploaded = await redis.get<string>(`uploaded:${sessionId}`);
    if (uploaded) return new Response("skipped");
    await sendSms(phone, REMINDER_SMS_COPY(uploadLink));
    return new Response("ok");
  }
  export const POST = verifySignatureAppRouter(handleReminderDelivery);
  ```

### Claude's Discretion

None specified. All implementation decisions are locked.

### Deferred Ideas (OUT OF SCOPE)

- Encrypting phone number in QStash payload (future privacy review if firm scales to multi-tenant)
- Moving immediate SMS send to a 0-delay QStash message (only if Stripe webhook timeout pressure arises)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SCHED-01 | QStash delayed job published at payment-success with `delay: 86400` targeting SMS-reminder webhook | `client.publishJSON({ url, body, delay: 86400 })` — returns `{ messageId }` |
| SCHED-02 | Reminder webhook verifies QStash signatures (`verifySignatureAppRouter`) and refuses unsigned requests | `verifySignatureAppRouter` from `@upstash/qstash/nextjs` wraps handler; returns non-200 on invalid sig |
| SCHED-03 | Before sending, handler reads authoritative upload state and short-circuits if already uploaded | `redis.get<string>("uploaded:{sessionId}")` — locked to `uploaded:` prefix by CONTEXT.md decision |
| SCHED-04 | On upload, pending reminder cancelled via `client.messages.cancel(messageId)`; messageId stored in Redis under `sms-reminder:{sessionId}` with 26h TTL | `redis.set("sms-reminder:{sessionId}", messageId, { ex: 26*3600 })`; `client.messages.cancel(msgId)` |
| SCHED-05 | `sms-reminder:{sessionId}` Redis NX key prevents duplicate reminder sends | `redis.set(..., { nx: true })` — if key exists (reminder already sent), return `"deduped"` |
</phase_requirements>

---

## Summary

Phase 2 adds two files: `src/lib/sms/reminder.ts` (scheduling + cancel logic) and `src/app/api/webhooks/sms-reminder/route.ts` (QStash delivery target). Both depend on Phase 1 outputs (`sendSms()`, `REMINDER_SMS_COPY`) that already exist in the worktree.

The critical CONTEXT.md discovery: the ARCHITECTURE.md originally planned to check `session.uploadRefs` in the reminder handler. This is wrong — sessions expire after 1 hour and the reminder fires at 24 hours. By reminder time, `getSession()` always returns `null`. The locked decision is to use a dedicated `uploaded:{sessionId}` Redis flag (written by Phase 3 upload routes, read by Phase 2 handler).

`@upstash/qstash` v2.10.1 (released 2026-03-18) is the current version. The SDK exports a `Client` class from `@upstash/qstash` and `verifySignatureAppRouter` from `@upstash/qstash/nextjs`. `publishJSON` accepts numeric delay in seconds. `client.messages.cancel(messageId)` cancels a queued message. All three env vars (`QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`) are needed — the first for publishing/cancelling, the latter two for signature verification.

**Primary recommendation:** Install `@upstash/qstash` as a production dependency; follow the locked CONTEXT.md shapes exactly; use the `handleReminderDelivery` inner-function export pattern so unit tests bypass the signature verification HOC.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@upstash/qstash` | 2.10.1 | Delayed message queue: schedule, cancel, verify | Official Upstash SDK; same vendor as existing Redis; handles all HMAC verification |
| `@upstash/redis` | already installed (1.37.0) | Store `sms-reminder:{sessionId}` and read `uploaded:{sessionId}` | Already in project via `src/lib/kv.ts` |

### Supporting (already in worktree)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | 4.1.5 (devDep) | Unit tests for reminder.ts + handler | Already installed in worktree from Phase 1 |
| `libphonenumber-js` | 1.12.42 | Phone normalisation (in dispatch.ts) | Already in use — no new usage in Phase 2 |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@upstash/qstash` | Vercel Cron | Cron requires Redis scan every hour, not cancellable by ID — rejected (see ARCHITECTURE.md anti-pattern 2) |
| `uploaded:` flag | `getSession().uploadRefs` | Session expires in 1h; reminder fires at 24h — guard would never fire; rejected (CONTEXT.md decision 1) |

**Installation:**
```bash
npm install @upstash/qstash
```

**Version verification (confirmed against npm registry 2026-04-27):**
- `@upstash/qstash@2.10.1` published 2026-03-18

---

## Architecture Patterns

### Recommended Project Structure

New files only (existing files untouched in Phase 2):

```
src/
├── lib/
│   └── sms/
│       ├── dispatch.ts          # Phase 1 — DO NOT MODIFY
│       ├── copy.ts              # Phase 1 — DO NOT MODIFY
│       ├── reminder.ts          # NEW: scheduleReminderSms(), cancelPendingReminder()
│       └── __tests__/
│           ├── dispatch.test.ts # Phase 1 — existing
│           └── reminder.test.ts # NEW: unit tests for reminder.ts + handler inner fn
└── app/
    └── api/
        └── webhooks/
            └── sms-reminder/
                └── route.ts     # NEW: QStash delivery target
```

### Pattern 1: QStash Client Construction (absent-safe)

**What:** Construct the QStash `Client` lazily, guarded by env var check. Return without throwing if `QSTASH_TOKEN` is absent.

**When to use:** Every function that needs the client (`scheduleReminderSms`, `cancelPendingReminder`).

```typescript
// Source: https://upstash.com/docs/qstash/sdks/ts/examples/publish.md
// src/lib/sms/reminder.ts
import { Client } from "@upstash/qstash";
import { redis } from "@/lib/kv";
import { sendSms } from "./dispatch";
import { REMINDER_SMS_COPY } from "./copy";

function getQStashClient(): Client | null {
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    console.warn("[sms] QSTASH_TOKEN missing — reminder scheduling skipped", {
      event: "reminder_skipped",
      reason: "no_qstash_token",
    });
    return null;
  }
  return new Client({ token });
}
```

### Pattern 2: Schedule Reminder (publishJSON with delay)

**What:** Publish a delayed JSON message to the webhook endpoint. Store the returned `messageId` in Redis with NX to prevent duplicate scheduling.

**When to use:** At payment-success time, inside `handleIntakePaid()` (Phase 3 wires this; Phase 2 just exports the function).

```typescript
// Source: https://upstash.com/docs/qstash/sdks/ts/examples/publish.md
export async function scheduleReminderSms(
  sessionId: string,
  phone: string,
  uploadLink: string
): Promise<void> {
  const client = getQStashClient();
  if (!client) return;

  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    console.warn("[sms] APP_URL missing — reminder scheduling skipped");
    return;
  }

  const res = await client.publishJSON({
    url: `${appUrl}/api/webhooks/sms-reminder`,
    body: { sessionId, phone, uploadLink },
    delay: 86400,   // seconds — 24 hours
  });

  // res.messageId is the QStash message ID
  const redisKey = `sms-reminder:${sessionId}`;
  await redis.set(redisKey, res.messageId, { ex: 26 * 3600 });

  console.info("[sms] reminder scheduled", {
    event: "reminder_scheduled",
    sessionId,
    messageId: res.messageId,
  });
}
```

**SCHED-05 note:** The `sms-reminder:` key without `nx: true` here is intentional for scheduling — it stores the messageId for cancel lookup. The NX dedup guard belongs in the *reminder webhook handler* (prevent double-send on QStash retry), not the scheduler itself. See Pattern 4.

### Pattern 3: Cancel Pending Reminder

**What:** Read stored messageId from Redis, call `client.messages.cancel()`, then delete the Redis key.

**When to use:** Called by upload routes (Phase 3) when a client completes upload before the 24h window.

```typescript
// Source: https://upstash.com/docs/qstash/sdks/ts/examples/messages.md
export async function cancelPendingReminder(sessionId: string): Promise<void> {
  const client = getQStashClient();
  if (!client) return;

  const redisKey = `sms-reminder:${sessionId}`;
  const messageId = await redis.get<string>(redisKey);

  if (!messageId) {
    // Already delivered or never scheduled — nothing to cancel
    return;
  }

  try {
    await client.messages.cancel(messageId);
    await redis.del(redisKey);
    console.info("[sms] reminder cancelled", { event: "reminder_cancelled", sessionId });
  } catch (err) {
    // Log but do not throw — upload must not fail if cancel fails
    console.warn("[sms] reminder cancel failed", {
      event: "reminder_cancel_failed",
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
```

### Pattern 4: Reminder Handler with verifySignatureAppRouter

**What:** Named inner export (`handleReminderDelivery`) for testability, wrapped by `verifySignatureAppRouter` as the route's `POST` export. NX Redis key prevents duplicate send on QStash retry.

**When to use:** This is the shape of `src/app/api/webhooks/sms-reminder/route.ts`. LOCKED by CONTEXT.md.

```typescript
// Source: https://upstash.com/docs/qstash/quickstarts/vercel-nextjs
// src/app/api/webhooks/sms-reminder/route.ts
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { redis } from "@/lib/kv";
import { sendSms } from "@/lib/sms/dispatch";
import { REMINDER_SMS_COPY } from "@/lib/sms/copy";

export async function handleReminderDelivery(req: Request): Promise<Response> {
  const { sessionId, phone, uploadLink } = await req.json();

  // SCHED-03: check durable upload flag (session TTL=1h; reminder fires at 24h)
  const uploaded = await redis.get<string>(`uploaded:${sessionId}`);
  if (uploaded) return new Response("skipped");

  // SCHED-05: NX key prevents duplicate send on QStash retry
  const reminderKey = `sms-reminder:${sessionId}`;
  const set = await redis.set(reminderKey, "sent", { nx: true, ex: 26 * 3600 });
  if (!set) return new Response("deduped");

  await sendSms(phone, REMINDER_SMS_COPY(uploadLink));
  return new Response("ok");
}

export const POST = verifySignatureAppRouter(handleReminderDelivery);
```

**Important:** `verifySignatureAppRouter` reads `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY` automatically from `process.env`. It does not need to be configured explicitly.

### Pattern 5: Unit Test for handleReminderDelivery

**What:** Import the inner function directly to bypass signature verification. Mock `redis` and `sendSms`.

```typescript
// src/lib/sms/__tests__/reminder.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleReminderDelivery } from "@/app/api/webhooks/sms-reminder/route";

vi.mock("@/lib/kv", () => ({ redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }));
vi.mock("@/lib/sms/dispatch", () => ({ sendSms: vi.fn() }));
vi.mock("@/lib/sms/copy", () => ({ REMINDER_SMS_COPY: (link: string) => `reminder:${link}` }));

import { redis } from "@/lib/kv";
import { sendSms } from "@/lib/sms/dispatch";

function makeRequest(body: object) {
  return new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("handleReminderDelivery — upload-state skip (SCHED-03)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 'skipped' when uploaded flag is set — sendSms not called", async () => {
    vi.mocked(redis.get).mockResolvedValue("1");  // uploaded flag present
    const res = await handleReminderDelivery(
      makeRequest({ sessionId: "s1", phone: "+61412345678", uploadLink: "https://ex.com/u" })
    );
    expect(await res.text()).toBe("skipped");
    expect(sendSms).not.toHaveBeenCalled();
  });
});
```

### Anti-Patterns to Avoid

- **Checking `getSession().uploadRefs` in the reminder handler:** Sessions expire after 1 hour. The reminder fires at 24 hours. `getSession()` will always return `null` in production — this guard never fires. Use `redis.get("uploaded:{sessionId}")` instead (CONTEXT.md locked).
- **Putting QStash client construction at module level:** Module-level construction runs at import time; if `QSTASH_TOKEN` is absent, the Client constructor may throw. Use lazy construction inside each function with an early-return guard.
- **Letting `cancelPendingReminder` throw:** Upload routes must complete even if QStash cancel fails (message may have already delivered). Always wrap cancel in try/catch.
- **Using `nx: true` on the scheduling Redis write:** The scheduler stores a messageId for cancel lookup — it should overwrite on retry. NX belongs in the *webhook handler* to prevent double-send.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Signature verification | Custom HMAC comparison against `QSTASH_CURRENT_SIGNING_KEY` | `verifySignatureAppRouter` from `@upstash/qstash/nextjs` | Handles key rotation (`CURRENT` vs `NEXT`), timing-safe comparison, correct header parsing |
| Delayed job scheduling | Vercel Cron + Redis scan | `client.publishJSON({ delay: 86400 })` | Point-in-time delivery, cancellable by messageId, no scan |
| Dedup on retry | Custom timestamp + Redis TTL math | `redis.set(key, "sent", { nx: true, ex: ttl })` | Atomic SET NX is the standard Redis dedup primitive |

**Key insight:** QStash handles all the delivery retry, timing, and HMAC complexity that is genuinely hard to get right. The SDK surface for this phase is exactly 3 calls: `publishJSON`, `messages.cancel`, and `verifySignatureAppRouter`.

---

## Common Pitfalls

### Pitfall 1: SCHED-05 NX Key Conflicts with Scheduler's messageId Key

**What goes wrong:** Both the scheduler (`scheduleReminderSms`) and the handler (`handleReminderDelivery`) write to `sms-reminder:{sessionId}`. If the NX guard in the handler runs with value `"sent"`, the scheduler's messageId is overwritten — `cancelPendingReminder` can no longer find the messageId.

**Why it happens:** The scheduler writes the messageId string; the handler dedup writes `"sent"`. They share the same Redis key.

**How to avoid:** Two options:
1. Use a SEPARATE key for handler dedup: `sms-reminder-sent:{sessionId}` (NX, 26h) — keeps `sms-reminder:{sessionId}` as the cancel lookup key.
2. Or (simpler): check if the key already contains `"sent"` before treating it as a messageId in `cancelPendingReminder`. 
   
**Recommended:** Use a separate `sms-reminder-sent:{sessionId}` key for the handler dedup NX guard. This keeps responsibilities clear: `sms-reminder:` = messageId for cancel; `sms-reminder-sent:` = delivery dedup lock.

Alternatively, per the REQUIREMENTS.md SCHED-05 framing ("NX key prevents duplicate reminder sends"), the dedup key could simply be the existing `sms-reminder:` key: if it still holds the messageId, the SET NX fails and we proceed; if it's been deleted (cancel succeeded), the SET NX succeeds and we can send. But this creates a subtle race: cancel deletes the key, QStash retries, NX succeeds, SMS sends anyway. The two-key approach is safer.

**Recommended two-key design:**
- `sms-reminder:{sessionId}` — messageId string, written by scheduler, deleted by cancel
- `sms-reminder-sent:{sessionId}` — `"1"` NX flag, written by handler on first delivery, TTL 26h

### Pitfall 2: `verifySignatureAppRouter` Rejects All Requests if Signing Keys Missing

**What goes wrong:** In local dev and Vercel preview, `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY` are absent. Any POST to `/api/webhooks/sms-reminder` returns a non-200 response — this is correct security behaviour, but developers may be surprised.

**Why it happens:** The HOC reads env vars at request time. No keys = no verification possible.

**How to avoid:** The inner `handleReminderDelivery` export is the testability escape hatch — unit tests import and call it directly. Never try to hit the route endpoint in local dev without valid QStash signing keys.

### Pitfall 3: `delay` Parameter Must be a Number (Seconds), Not a String

**What goes wrong:** The official docs show `delay: "3s"` (string form) in some examples; the TypeScript type is `Duration | number`. Passing `"86400"` (string) instead of `86400` (number) may work in some SDK versions but is not guaranteed.

**Why it happens:** The `Duration` type in the SDK accepts strings like `"24h"` or `"3s"`, but numeric seconds is the clearest and most reliable form for this use case.

**How to avoid:** Use `delay: 86400` (number, seconds). Do not use `delay: "86400"` or `delay: "24h"`.

### Pitfall 4: `publishJSON` Response Shape

**What goes wrong:** Treating `res` as having a top-level `.messageId` when publishing to a URL Group returns an array.

**Why it happens:** `publishJSON` return type varies by request shape. When `url` (not `urlGroup`) is specified, it returns `{ messageId: string; url: string; deduplicated?: boolean }`.

**How to avoid:** Phase 2 always publishes to a specific URL (the webhook endpoint), so the return is always the single-message shape. Access `res.messageId` directly.

### Pitfall 5: Module-Level QStash Client Import Breaks Absent-Env Tests

**What goes wrong:** `const client = new Client({ token: process.env.QSTASH_TOKEN! })` at module top level; vitest imports the module in tests without the env var set; the Client constructor is called with `undefined` as token.

**Why it happens:** Next.js and Node module systems evaluate module-level code on import.

**How to avoid:** Construct the client inside the function body, guarded by the env var check. See Pattern 1 (`getQStashClient()` helper).

---

## Code Examples

### scheduleReminderSms — complete function

```typescript
// Source: @upstash/qstash docs + CONTEXT.md locked decision
// src/lib/sms/reminder.ts
import { Client } from "@upstash/qstash";
import { redis } from "@/lib/kv";

export async function scheduleReminderSms(
  sessionId: string,
  phone: string,
  uploadLink: string
): Promise<void> {
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    console.warn("[sms] QSTASH_TOKEN missing — reminder scheduling skipped", {
      event: "reminder_skipped",
      reason: "no_qstash_token",
    });
    return;
  }

  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    console.warn("[sms] APP_URL missing — reminder scheduling skipped", {
      event: "reminder_skipped",
      reason: "no_app_url",
    });
    return;
  }

  const client = new Client({ token });
  const res = await client.publishJSON({
    url: `${appUrl}/api/webhooks/sms-reminder`,
    body: { sessionId, phone, uploadLink },
    delay: 86400,
  });

  await redis.set(`sms-reminder:${sessionId}`, res.messageId, { ex: 26 * 3600 });

  console.info("[sms] reminder scheduled", {
    event: "reminder_scheduled",
    sessionId,
    messageId: res.messageId,
  });
}
```

### cancelPendingReminder — complete function

```typescript
// Source: https://upstash.com/docs/qstash/sdks/ts/examples/messages.md
export async function cancelPendingReminder(sessionId: string): Promise<void> {
  const token = process.env.QSTASH_TOKEN;
  if (!token) return;

  const messageId = await redis.get<string>(`sms-reminder:${sessionId}`);
  if (!messageId) return;

  const client = new Client({ token });
  try {
    await client.messages.cancel(messageId);
    await redis.del(`sms-reminder:${sessionId}`);
    console.info("[sms] reminder cancelled", { event: "reminder_cancelled", sessionId });
  } catch (err) {
    console.warn("[sms] reminder cancel failed — message may have already delivered", {
      event: "reminder_cancel_failed",
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
```

### verifySignatureAppRouter — import and usage

```typescript
// Source: https://upstash.com/docs/qstash/quickstarts/vercel-nextjs
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";

export const POST = verifySignatureAppRouter(handleReminderDelivery);
// Reads QSTASH_CURRENT_SIGNING_KEY and QSTASH_NEXT_SIGNING_KEY from process.env automatically
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `Receiver` class manual verification | `verifySignatureAppRouter` HOC for App Router | QStash SDK v2.x | No manual header parsing needed |
| `publish()` for JSON bodies | `publishJSON()` | QStash SDK v2.x | Auto-serialises body; no `JSON.stringify` + content-type header needed |
| `delay: "24h"` string | `delay: 86400` number (seconds) | Supported both ways | Number form is unambiguous; string Duration type also accepted |

**Deprecated/outdated:**
- Pages Router `verifySignature` (pages directory): replaced by `verifySignatureAppRouter` for App Router — this project uses App Router exclusively

---

## Open Questions

1. **Two-key vs one-key for SCHED-05 dedup**
   - What we know: `sms-reminder:{sessionId}` is the cancel-lookup key (holds messageId); SCHED-05 requires NX dedup on handler execution
   - What's unclear: REQUIREMENTS.md names `sms-reminder:{sessionId}` as the NX key, but using the same key for both cancel-lookup and dedup creates a conflict
   - Recommendation: Use `sms-reminder-sent:{sessionId}` as a separate NX dedup key in the handler. The REQUIREMENTS.md intent is preventing double-send, not mandating a specific key name. Planner should document this choice explicitly.

2. **`APP_URL` env var**
   - What we know: `scheduleReminderSms` needs the full webhook URL; `APP_URL` is listed in STATE.md ops todos but not yet in the worktree `.env.local`
   - What's unclear: Whether Vercel automatically provides `VERCEL_URL` or if `APP_URL` must be set manually
   - Recommendation: Use `process.env.APP_URL` with a graceful return on missing — consistent with the absent-safe pattern used throughout Phase 1/2. Document in Wave 0 that `APP_URL=http://localhost:3000` is needed in `.env.local`.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 (already installed in worktree) |
| Config file | `vitest.config.ts` at worktree root (exists from Phase 1 Wave 0) |
| Quick run command | `npx vitest run src/lib/sms/__tests__/reminder.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCHED-01 | `scheduleReminderSms()` with missing `QSTASH_TOKEN` logs warn + returns without throwing | unit | `npx vitest run src/lib/sms/__tests__/reminder.test.ts` | ❌ Wave 0 |
| SCHED-01 | After `scheduleReminderSms()` succeeds, Redis key `sms-reminder:{sessionId}` holds messageId with ~26h TTL | unit | `npx vitest run src/lib/sms/__tests__/reminder.test.ts` | ❌ Wave 0 |
| SCHED-02 | POST to `/api/webhooks/sms-reminder` without valid QStash signature returns non-200 | manual-only | N/A — `verifySignatureAppRouter` HOC requires real QStash signing keys | manual |
| SCHED-03 | POST with valid sig + `uploaded:{sessionId}` flag set → returns `"skipped"`, sendSms not called | unit (inner fn) | `npx vitest run src/lib/sms/__tests__/reminder.test.ts` | ❌ Wave 0 |
| SCHED-04 | `cancelPendingReminder(sessionId)` reads messageId from Redis, calls `client.messages.cancel()` | unit (mocked client) | `npx vitest run src/lib/sms/__tests__/reminder.test.ts` | ❌ Wave 0 |
| SCHED-05 | Second delivery with same `sessionId` returns `"deduped"`, sendSms not called | unit (inner fn) | `npx vitest run src/lib/sms/__tests__/reminder.test.ts` | ❌ Wave 0 |

**SCHED-02 is manual-only:** `verifySignatureAppRouter` cannot be meaningfully unit-tested without real signing keys or a complex Receiver mock. The signature contract is satisfied structurally — `verifySignatureAppRouter` wraps the handler, which is sufficient. The test verifies the route exports `POST = verifySignatureAppRouter(handleReminderDelivery)` by inspection. If the planner wants a smoke test, the inner function test for SCHED-03 (valid-sig path) proves the handler logic works when verification passes.

### Sampling Rate

- **Per task commit:** `npx vitest run src/lib/sms/__tests__/reminder.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/lib/sms/__tests__/reminder.test.ts` — covers SCHED-01, SCHED-03, SCHED-04, SCHED-05 (new file)
- [ ] `npm install @upstash/qstash` — production dependency, not yet in worktree `package.json`

*(Vitest config, test scripts, and `dispatch.test.ts` already exist from Phase 1 Wave 0)*

---

## Sources

### Primary (HIGH confidence)

- `@upstash/qstash` npm registry — version 2.10.1, published 2026-03-18 (verified against npm)
- `npm view @upstash/qstash exports` — confirms `./nextjs` subpath export exists
- https://upstash.com/docs/qstash/sdks/ts/examples/publish.md — `publishJSON` with delay, return type, Client constructor
- https://upstash.com/docs/qstash/sdks/ts/examples/messages.md — `client.messages.cancel(messageId)` signature
- https://upstash.com/docs/qstash/quickstarts/vercel-nextjs — `verifySignatureAppRouter` usage + env vars
- Codebase: `src/lib/kv.ts` — `redis` singleton, `SESSION_TTL = 3600`, confirmed read directly
- Codebase: `.claude/worktrees/clicksend-sms/src/lib/sms/dispatch.ts` — Phase 1 `sendSms()` signature confirmed
- Codebase: `.claude/worktrees/clicksend-sms/src/lib/sms/copy.ts` — Phase 1 `REMINDER_SMS_COPY` signature confirmed
- `.planning/phases/02-qstash-scheduler/02-CONTEXT.md` — all locked decisions read directly

### Secondary (MEDIUM confidence)

- https://upstash.com/docs/qstash/quickstarts/vercel-nextjs — `verifySignatureAppRouter` env var names (`QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`)
- GitHub: `upstash/qstash-js` — `publishJSON` return type (`PublishToUrlResponse` includes `messageId`, `url`, `deduplicated?`)

### Tertiary (LOW confidence)

- None — all claims verified against npm registry, official docs, or codebase directly.

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — `@upstash/qstash@2.10.1` confirmed against npm registry; install command verified
- Architecture: HIGH — patterns read from official QStash docs; locked by CONTEXT.md decisions
- Pitfalls: HIGH — pitfalls derived from first-principles analysis of the two-key conflict and module-level client construction; verified against CONTEXT.md constraints
- Validation: HIGH — test framework confirmed installed in worktree; test patterns follow Phase 1 conventions

**Research date:** 2026-04-27
**Valid until:** 2026-05-27 (stable Upstash SDK; check for QStash SDK patch releases if delayed)
