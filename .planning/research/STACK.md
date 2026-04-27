# Stack Research

**Domain:** Transactional SMS + Delayed Job Scheduling (ClickSend, AU, Vercel/Next.js)
**Researched:** 2026-04-24
**Confidence:** MEDIUM-HIGH (ClickSend REST surface verified via official docs; QStash delay params verified via official docs; libphonenumber-js bundle data from npm/bundlephobia; AU sender ID regulatory detail from ClickSend Help)

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| ClickSend REST API v3 | v3 (current) | Outbound transactional SMS to AU clients | AU-native gateway, handles STOP opt-outs automatically, supports alphanumeric sender IDs, pricing per-segment — no SDK needed, plain fetch matches existing Zapier/Resend pattern |
| `@upstash/qstash` | 2.8.4 | One-shot 24-hour delayed job (nudge SMS if no upload) | HTTP-based message queue purpose-built for serverless; `delay: 86400` in `publishJSON()` call; no worker process; free tier covers 1,000 messages/day with max 7-day delay; already aligned with existing Upstash Redis stack |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `libphonenumber-js` | latest (^1.x) | E.164 normalisation + mobile-vs-landline detection for AU numbers | Import from `libphonenumber-js/min` on the server-side SMS dispatch path only — this module never reaches the client bundle, so the ~145 kB metadata cost stays in the Node.js runtime; needed because the existing `validatePhone` in `src/lib/validators.ts` does not produce E.164 |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `CLICKSEND_USERNAME` + `CLICKSEND_API_KEY` env vars | Basic Auth credentials | btoa(`${username}:${apiKey}`) → `Authorization: Basic …` header; never log the key; guard with absent-check so app boots without them |
| `QSTASH_TOKEN` + `QSTASH_CURRENT_SIGNING_KEY` + `QSTASH_NEXT_SIGNING_KEY` | QStash publish + signature verification | Upstash console provides all three; verify incoming QStash callbacks with the SDK's `Receiver` class to prevent spoofed nudge triggers |

---

## Installation

```bash
# One new runtime dependency (QStash)
npm install @upstash/qstash

# One new utility (phone normalisation)
npm install libphonenumber-js
```

ClickSend needs zero new packages — use the native `fetch` already available in Node 18+/Next.js App Router.

---

## ClickSend REST API Reference

**Base URL:** `https://rest.clicksend.com/v3`

**Authentication:** HTTP Basic Auth — username is your ClickSend account username, password is your API key (not account password).

```typescript
const token = Buffer.from(`${username}:${apiKey}`).toString('base64');
// Authorization: Basic <token>
```

**Send SMS endpoint:** `POST /v3/sms/send`

**Minimal request body:**
```json
{
  "messages": [
    {
      "to": "+61412345678",
      "from": "AquariusLaw",
      "body": "Your upload link: … Reply STOP to opt out.",
      "source": "nodejs"
    }
  ]
}
```

Key fields:
- `to` — E.164 format required (`+61…`)
- `from` — optional sender ID; alpha tag (max 11 chars, no spaces/specials) or dedicated number; if omitted, a shared number is used
- `body` — message text; include "Reply STOP to opt out" per AU Spam Act
- `source` — freeform label for your records (e.g. `"nodejs"`)

**Response shape (success):**
```json
{
  "http_code": 200,
  "response_code": "SUCCESS",
  "data": {
    "total_price": 0.0792,
    "total_count": 1,
    "queued_count": 1,
    "blocked_count": 0,
    "messages": [{ "status": "SUCCESS", ... }]
  }
}
```

`blocked_count > 0` means the number was on the opt-out list — ClickSend blocks it silently without an HTTP error. Check this field in the response handler.

**Opt-out handling:** ClickSend manages the opt-out list automatically. When a recipient replies STOP, all future sends to that number are blocked by ClickSend's platform — no developer-side list check needed before sending. The `blocked_count` field in the response reports opt-out blocks.

**URL-in-message caveat:** ClickSend is currently pausing SMS messages containing URLs for *new accounts* pending manual approval. Contact ClickSend support to get URL messaging approved before going live. Until approved, send a URL-free nudge ("Your upload link was emailed to you. Please check your inbox.") as the fallback body.

---

## QStash Delayed Job Reference

**SDK:** `@upstash/qstash` v2.8.4

**Publish with 24h delay:**
```typescript
import { Client } from '@upstash/qstash';

const qstash = new Client({ token: process.env.QSTASH_TOKEN! });

await qstash.publishJSON({
  url: `${process.env.APP_URL}/api/sms/nudge`,
  body: { sessionId },
  delay: 86400, // seconds — 24 hours
});
```

**Receive + verify at the nudge endpoint:**
```typescript
import { Receiver } from '@upstash/qstash';

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY!,
});

await receiver.verify({
  signature: req.headers.get('upstash-signature')!,
  body: rawBodyString,
});
```

**Free tier limits (verified 2026-04):**
- 1,000 messages/day
- Max delay: 7 days (24h is well within this)
- Pay-as-you-go: $1 per 100,000 messages

At one SMS send + one nudge per paying client session, this will not approach free-tier limits unless volume is very high.

---

## Phone Normalisation Reference

**Approach:** `libphonenumber-js/min` (min metadata build — sufficient for AU parsing + mobile detection without the full 550 kB world metadata).

```typescript
import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js/min';

function normaliseAuPhone(raw: string): { e164: string; isMobile: boolean } | null {
  try {
    const parsed = parsePhoneNumber(raw, 'AU');
    if (!parsed?.isValid()) return null;
    const type = parsed.getType(); // 'MOBILE' | 'FIXED_LINE' | etc.
    return {
      e164: parsed.number,       // "+61412345678"
      isMobile: type === 'MOBILE' || type === 'MOBILE_OR_FIXED_LINE',
    };
  } catch {
    return null;
  }
}
```

Return `null` (skip + log) for landlines and invalid numbers. This replaces the existing `validatePhone` on the SMS dispatch path only — do not change the intake validator itself.

**Bundle cost:** `libphonenumber-js/min` minzipped is ~25 kB (min metadata covers validation + number type; full metadata is ~145 kB). Because SMS dispatch runs in a Next.js Route Handler (server-only), this cost is cold-start latency, not client bundle size — and 25 kB is negligible.

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| Plain `fetch` to ClickSend REST | Official ClickSend Node.js SDK (`clicksend-nodejs`) | SDK is an OpenAPI-generated wrapper (~large, auto-generated code); the REST surface needed here is a single endpoint; existing codebase uses plain fetch for all third-party calls (Zapier, Resend pattern); SDK adds maintenance risk with no benefit |
| `@upstash/qstash` for delayed job | Vercel Cron | Vercel Cron only supports recurring schedules with a minimum 1-minute granularity — there is no mechanism to schedule a single one-shot job for a specific future time. Would require a polling approach (cron every N minutes checking Redis for overdue sessions), adding complexity and Redis load |
| `@upstash/qstash` for delayed job | Inngest | Inngest is a better fit when you need durable multi-step workflows with `step.sleep()`. For a single fire-and-forget HTTP call 24 hours later, QStash is lighter (no `serve()` handler bootstrap, no separate Inngest app registration); Inngest free tier is 50K runs/month which is fine but the added SDK surface is unnecessary here |
| `@upstash/qstash` for delayed job | Bull/BullMQ + Redis | Requires a persistent worker process — incompatible with Vercel's serverless model |
| `libphonenumber-js/min` | Hand-rolled regex | AU mobile prefixes are `04xx` and could be regex-matched but this doesn't produce E.164 and misses edge cases (international format inputs, number portability). `libphonenumber-js` is the canonical library for this. |
| `libphonenumber-js/min` | `google-libphonenumber` (Java port) | Larger, less ergonomic for TypeScript; `libphonenumber-js` is the idiomatic JS choice |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Twilio | User directive; also more expensive per segment in AU, US-centric, no native AU sender ID management | ClickSend (AU-based, handles STOP natively) |
| ClickSend Node.js SDK (`clicksend-nodejs`) | Auto-generated, bloated, not maintained to the same standard as first-party SDKs; plain fetch achieves identical results with less code and zero new deps | Native `fetch` with `Authorization: Basic …` header |
| Vercel Cron for the 24h nudge | Cannot schedule one-shot future jobs — only recurring schedules. Would force a polling pattern | `@upstash/qstash` with `delay: 86400` |
| Storing the QStash job ID in Redis with a manual "cancel" flow | Unnecessary complexity for a single nudge per session; checking "already uploaded?" at nudge execution time is simpler and more reliable | Check `uploadedAt` field in Redis at nudge execution time and no-op if present |
| Sending SMS from a client-side Route with no rate limiting | Webhook abuse vector; each session must be limited to at most 2 outbound SMS | Apply existing `@upstash/ratelimit` pattern (already in codebase) per sessionId on the SMS dispatch path |

---

## AU Sender ID Regulatory Notes (Confidence: HIGH)

From 1 July 2026, ACMA requires all alphanumeric sender IDs (alpha tags) used to send to AU numbers to be registered. Registration opened 30 November 2025. ClickSend supports self-service registration. Key points:

- Alpha tags are max 11 characters, no spaces or special characters (e.g. `AquariusLaw`)
- Recipients cannot reply to alpha tag messages — STOP opt-outs are handled by ClickSend's platform keyword detection on the shared inbound path
- Dedicated AU numbers allow two-way replies but require ABN and business address verification
- Shared numbers are free and ready to use but are not suitable for brand-identified communications
- **Recommendation:** Register an alpha tag for `AquariusLaw` (or similar ≤11 char brand name) before July 2026; use shared number in dev/staging

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@upstash/qstash` 2.8.4 | Node.js 18+, Next.js 15+/16+, App Router | Uses native fetch; works in Edge and Node runtimes; `Receiver.verify()` requires raw body string (not parsed JSON) — use `req.text()` not `req.json()` in the nudge route handler |
| `libphonenumber-js` 1.x | Node.js 18+, TypeScript 5 strict | Import from `/min` sub-path for server-only use; safe to import in any Next.js Route Handler or server action |
| ClickSend REST v3 | Any fetch-capable runtime | No SDK dependency; `Buffer.from(...).toString('base64')` for Basic Auth in Node; use `btoa(...)` in Edge runtime |

---

## Sources

- `https://developers.clicksend.com/docs/messaging/sms/other/send-sms` — Send endpoint, request body, response shape (HIGH confidence, official docs verified 2026-04)
- `https://help.clicksend.com/article/jg3o5n5mbo-how-does-the-opt-out-system-work` — Opt-out automatic blocking behaviour (HIGH confidence, official help article)
- `https://help.clicksend.com/en/articles/43652-australia-61` — AU sender ID types and rules (HIGH confidence, official help article)
- `https://help.clicksend.com/en/articles/46062-acma-upcoming-changes-to-alphanumeric-senderids-alpha-tags-registration-usage` — ACMA alpha tag registration deadline (HIGH confidence, official help article)
- `https://upstash.com/docs/qstash/features/delay` — QStash delay header syntax and SDK `delay` param (HIGH confidence, official docs)
- `https://upstash.com/pricing/qstash` — Free tier limits: 1K messages/day, 7-day max delay (HIGH confidence, official pricing page 2026-04)
- `https://www.npmjs.com/package/@upstash/qstash` — Package version 2.8.4 (HIGH confidence, npm registry)
- `https://www.npmjs.com/package/libphonenumber-js` + `https://github.com/catamphetamine/libphonenumber-js` — Bundle size, `/min` sub-package, `getType()` for mobile detection (MEDIUM confidence, npm/GitHub — bundlephobia page did not render)
- `https://vercel.com/docs/cron-jobs` — Vercel Cron supports only recurring schedules, not one-shot delayed jobs (HIGH confidence, official docs)

---
*Stack research for: ClickSend SMS + QStash delayed nudge on Next.js/Vercel (AU)*
*Researched: 2026-04-24*
