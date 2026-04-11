---
title: Late Document Upload — Post-Chat File Delivery
type: feat
date: 2026-04-11
source_brainstorm: docs/brainstorms/2026-04-11-late-document-upload-brainstorm.md
review_pass: 2026-04-11 (Kieran + Simplicity + Security)
stack_notes: Next.js 16.2.3 App Router, React 19.2.4, @vercel/blob 2.3.3, @upstash/redis 1.37.0, resend 6.10.0, stripe 22.0.1
---

# ✨ Late Document Upload — Post-Chat File Delivery

## Execution Status (2026-04-11)

**Branch**: `feat/late-document-upload` (off `main`).

| Phase | Status | Notes |
|---|---|---|
| A — Plumbing & Shared Libs | ✅ Done | Deps installed; `allowed-types`, `rate-limit`, `upload-tokens`, `upload-session`, `kv` redis export, `zapier` URL param, new types all landed. |
| B — Stripe Webhook + Receipt Email + Retry Dedupe | ✅ Done | `payment-receipt.tsx` React Email template; webhook mints token, `SET NX` dedupe, sends Resend receipt. Resend tracking assertion gated on `NODE_ENV === 'production'`. |
| C — Upload UI (cookie redirect + pages + client) | ✅ Done | `/upload/[token]`, `/upload/session`, `late-upload-client.tsx`, security headers on `next.config.ts`. |
| D — Upload API + Fan-out + Cron + Revoke CLI | ✅ Done | `/api/late-upload/session` route, `handle-completed.ts` (magic-byte + Zaps + notifications), `/api/cron/upload-cleanup`, `src/scripts/revoke-upload-token.ts`, `vercel.json`. |
| E — Security/Privacy/Testing/Docs | ⏸ Deferred | Test matrix + firm Zap confirmation + privacy-policy copy belong to a follow-up PR. |

**Unset env vars (required before prod)**: `STRIPE_WEBHOOK_SECRET`, `BLOB_READ_WRITE_TOKEN` (already present but empty in some places), `ZAPIER_ATTACH_WEBHOOK_URL`, `ZAPIER_AUDIT_WEBHOOK_URL`. Generated locally: `UPLOAD_COOKIE_SECRET`, `CRON_SECRET`. Firm must configure two new Zaps (attach-to-matter, audit-to-Sheet).

**Verification**: `npm run build` passes, `npm run lint` shows only pre-existing Phase 1 warnings.

## Overview

Give paying clients a way to upload documents (charge sheets, court papers, photos) **after** the chat session has ended, via a tokenized magic-link URL sent in the Resend payment-receipt email. Uploaded files attach to the correct Smokeball matter through a second Zapier workflow; the firm receives an email ping per upload event and a **durable audit row** is appended to a firm-owned Google Sheet via a third Zap. Links stay valid for **7 days** and are **multi-use**.

The existing `showOptions` nudge after payment already surfaces "Yes, I have documents to upload" vs "No, I'll upload later" — but the "later" branch has no mechanism behind it. This plan builds that mechanism and also makes "I'll upload later" the **default safety net** for every paying client, whether or not they pick that branch.

## Problem Statement / Motivation

- Criminal-intake clients rarely have all their documents at the moment they book. Charge sheets and bail paperwork usually arrive over the following days.
- The current Phase 1 upload tool only works inside an active 1 h Redis chat session. When the TTL expires, there is no pathway for the client to get files to the firm except by emailing attachments (lossy, often wrong inbox, no matter linkage).
- The firm uses Smokeball as the source of truth; any ad-hoc email won't land on the right matter.
- Legal intake under APP 11 needs a durable audit trail of what files were received, when, and how they were disposed of.

## Proposed Solution

- After successful Stripe checkout, the webhook handler generates a cryptographically random **upload token**, stores the hashed token in a new Redis namespace with a 7-day TTL, and sends the client a Resend receipt email containing `https://<domain>/upload/<token>`.
- A GET to `/upload/[token]` validates the token, sets a **signed httpOnly session cookie**, and 302-redirects to `/upload/session` so the token never appears in the upload UI's URL bar (stronger than `history.replaceState`, which can't protect against extension pre-reads or Vercel edge logs of the redirected URL). The `/upload/session` page reads the cookie and renders the upload UI.
- `POST /api/late-upload/session` issues Vercel Blob **client-upload** tokens via `handleUpload`, because Vercel's 4.5 MB server-body cap would block 10 MB files routed through a Route Handler. The route verifies the session cookie, enforces rate limits, and hands out short-lived upload tokens scoped to the client's matter.
- Vercel Blob's `onUploadCompleted` callback (signed HMAC-verified by `@vercel/blob`'s `handleUpload` using `BLOB_READ_WRITE_TOKEN`) fires a three-step fan-out:
  1. **Magic-byte validation** — `file-type` inspects the first bytes of the uploaded blob; mismatched MIME → `del()` the blob and abort the fan-out.
  2. **Smokeball attach Zap** (`ZAPIER_ATTACH_WEBHOOK_URL`) with the blob URL, matter reference, and client metadata.
  3. **Durable audit Zap** (`ZAPIER_AUDIT_WEBHOOK_URL`) that appends a row to a firm-owned Google Sheet — satisfies APP 11 durability without new infra.
  4. Per-event Resend notification to `FIRM_NOTIFY_EMAIL` (plaintext — no template file) and a short confirmation email to the client ("A file was just uploaded to your matter") that acts as an out-of-band token-misuse tripwire.
- The token is **not** consumed on use; it keeps working until its 7-day TTL expires. Returning clients can upload more files on later visits.
- A **revocation CLI** (`npm run revoke-upload-token -- --session <id>`) gives the firm a single lever if a client reports a forwarded/leaked link.
- A **weekly Vercel Cron** runs `del()` on blobs older than 30 days to satisfy APP 11.2 ("destroy when no longer needed").

## Why This Approach (decision log — brainstorm + review pass)

| Decision | Chosen | Rejected alternatives |
|---|---|---|
| Client identification | Tokenized magic link in receipt email | Reference code + email verify (friction); full client portal (overkill); SMS OTP (extra cost, carrier flake) |
| Token format | `crypto.randomBytes(32)` base64url, SHA-256 hashed at rest | UUID v4 (entropy too low per OWASP); signed JWT (no server-side revocation benefit) |
| Token lifetime | 7 days | 24 h (too short for court documents); 30 d (stale-token hygiene risk) |
| Token semantics | Multi-use until TTL | Single-use (re-issuing on every use is complex; clients upload in waves) |
| Token URL hygiene | **Cookie-redirect** — GET `/upload/[token]` sets signed httpOnly cookie then 302 → `/upload/session` | `history.replaceState` alone (extensions read `tab.url` before `useEffect` runs; corporate scanners still log the path); fragment-based token (stronger but requires a client bootstrap round-trip, fragile if JS disabled) — deferred as follow-up hardening |
| Redis namespace | Separate `upload-token:*` key family, independent of `session:*` | Reuse chat session key (breaks 1 h privacy TTL) |
| Storage backing | Vercel Blob **client uploads** (`@vercel/blob/client`) | Server `put()` (fails at >4.5 MB per Vercel docs); direct-stream to Zapier (no retries, couples upload success to Zap health) |
| Delivery to Smokeball | Second Zapier attach-to-matter workflow keyed by `matterRef` | Direct Smokeball REST API (firm has no two-way API access today) |
| Audit durability | **Third Zap** appends each upload event to a firm-owned Google Sheet | 7-day Redis TTL only (evaporates, fails APP 11); Postgres/Neon (new infra); Vercel Blob JSONL (read-back is awkward) |
| Content safety | **Magic-byte validation** on completion via `file-type`, mismatched files are `del()`ed | Declared Content-Type only (trivially spoofed — `.php` as `application/pdf` = phishing under firm's domain) |
| Rate limiting | **Two limiters**: per-token sliding window (20/h), per-endpoint global cap (500/h) | Three-limiter defense-in-depth (overkill for firm volume); one limiter (no botnet safety net) |
| Firm notification | Plaintext `resend.emails.send({ text })` | React Email template (ceremony for a one-inbox internal ping) |
| Client notification on upload | Every successful upload pings the client's email | Silent (no out-of-band tripwire for forwarded/leaked links) |
| Delivery scope | Sent with every paid Stripe receipt | Only on "I'll upload later" branch (branching logic; no safety net if in-chat upload fails) |
| Stripe retry dedupe | `SET NX` on `stripe-session:<id>` → raw token hash, 7-day TTL | Ignore (clients get duplicate receipts on every webhook retry) |

## Prerequisites (fixed inside this plan)

Phase 1's current state (as of 2026-04-11) has several gaps this feature depends on. Phase A fixes these rather than blocking on a separate Phase 1 patch.

- [ ] `STRIPE_WEBHOOK_SECRET` is empty in `.env.local` — webhook signature verification currently 400s. **Fill in Phase A.**
- [ ] `ZAPIER_WEBHOOK_URL` is empty — `src/lib/zapier.ts:2` will throw on first call. **Fill in Phase A.**
- [ ] `BLOB_READ_WRITE_TOKEN` is missing — Blob calls fail outside Vercel-managed env. **Fill in Phase A.**
- [ ] Phase 1 never persists client `name`/`email`/`phone` to Redis. **Not a blocker**: we read `customer_details.email`/`customer_details.name` directly from the Stripe webhook event, always populated on completed sessions.
- [ ] Phase 1 has no Smokeball matter ID. **Not a blocker**: `matterRef = sessionId` — the chat session ID already stamped into Stripe metadata at `src/app/api/checkout/route.ts`. Both the create-matter Zap (Phase 1 submit flow) and the attach-file Zap (this plan) key on `matterRef`, so Smokeball can correlate without two-way API access.

## Technical Approach

### Architecture (additions shown in **bold**)

```
Chat (paid) → initiatePayment → Stripe Checkout → checkout.session.completed webhook
                                                          │
                                                          ├─ updateSession(sessionId, {paid})                [existing]
                                                          ├─ **SET NX stripe-session:<id> → tokenHash**       [new, retry dedupe]
                                                          ├─ **createUploadToken()**                          [new]
                                                          └─ **resend.emails.send(receipt with magic link)**  [new]

Client clicks link in email → GET /upload/[token]                                                             [new page]
                                    │
                                    ├─ resolveUploadToken (O(1) Redis lookup on sha256 hash)
                                    ├─ invalid/expired → notFound() (Next 16 built-in 404)
                                    └─ valid → set signed httpOnly cookie, 302 → /upload/session

GET /upload/session                                                                                           [new page]
                                    │
                                    ├─ read + verify signed cookie
                                    └─ render LateUploadClient

Client submits files → @vercel/blob/client upload() → **POST /api/late-upload/session**                      [new route]
                                                              │
                                                              ├─ read + verify signed cookie (auth)
                                                              ├─ Promise.all([tokenLimiter, globalLimiter])
                                                              ├─ handleUpload.onBeforeGenerateToken →
                                                              │     { allowedContentTypes, maximumSizeInBytes, pathnamePrefix: <hash-slice>/<matterRef>/, tokenPayload }
                                                              └─ handleUpload.onUploadCompleted (HMAC-verified by @vercel/blob):
                                                                      ├─ Zod-parse tokenPayload
                                                                      ├─ **magic-byte check via `file-type`** → mismatch? del(blob) + abort
                                                                      ├─ sendToZapier(ATTACH_ZAP_URL, {…})
                                                                      ├─ sendToZapier(AUDIT_ZAP_URL, {…})    [durable trail → Google Sheet]
                                                                      ├─ resend.emails.send(firm notice — plaintext)
                                                                      └─ resend.emails.send(client notice — "file received")

Weekly Vercel Cron → /api/cron/upload-cleanup → list blobs → del() anything older than 30 days                [new route]
```

### Redis Schema

New namespace, independent of `session:*` and `SESSION_TTL` (1 h).

| Key | Value | TTL | Notes |
|---|---|---|---|
| `upload-token:<sha256(rawToken)>` | JSON `{ matterRef, clientEmail, clientName, sessionId, createdAt }` | 7 days (`604800`) | Only the hashed token is ever at rest. Raw token lives in the email, in the URL for ~50 ms during the GET redirect, and in the signed cookie thereafter. No `version` field — YAGNI; if the schema ever changes, reads will fail and we add it then. |
| `stripe-session:<stripeSessionId>` | `<tokenHash>` (string) | 7 days | **Stripe retry dedupe.** `SET NX` — if present, a retry skips token minting and re-sends the same email (Phase C, promoted from prose to first-class task). |
| `upload-rl:token:<sha256(rawToken)>` | (managed by `@upstash/ratelimit`) | derived from window | Sliding window 20 / 1 h. |
| `upload-rl:global` | (managed by `@upstash/ratelimit`) | derived from window | Sliding window 500 / 1 h — global botnet safety net. |
| `upload-rl:get:<ip>` | (managed by `@upstash/ratelimit`) | derived from window | Sliding window 120 / 1 h — limits GET traffic on `/upload/[token]` (token-guessing protection; POST is already behind cookie auth). |

Durable audit trail lives in the firm's Google Sheet via the audit Zap. No `upload-log:*` Redis mirror.

### Token Format & Session Cookie

```
rawToken    = crypto.randomBytes(32).toString('base64url')                // 43 chars, ~256 bits
tokenHash   = crypto.createHash('sha256').update(rawToken).digest('hex')
redisKey    = `upload-token:${tokenHash}`
emailLink   = `${process.env.APP_URL}/upload/${rawToken}`                  // APP_URL, not NEXT_PUBLIC_URL

// Signed cookie minted on valid GET /upload/[token]
cookieValue = base64url(JSON.stringify({ matterRef, sessionId, exp }))
            + '.' + hmacSHA256(cookieValue, process.env.UPLOAD_COOKIE_SECRET)
cookieName  = 'au_upload'
cookieOpts  = { httpOnly: true, secure: true, sameSite: 'lax', path: '/upload', maxAge: 60*60*24*7 }
```

- Base64url (RFC 4648) survives mail clients and query parsers with no percent-encoding.
- SHA-256-at-rest means a Redis snapshot leak cannot be replayed.
- 256 bits of entropy — safely above OWASP's 128-bit floor.
- The session cookie carries only `{ matterRef, sessionId, exp }` — NO client email/name (pulled from Redis each request), NO raw token.
- `UPLOAD_COOKIE_SECRET` is a new 32-byte random env var set once at deploy time.
- **Fragment-based token** (token in `#hash`, resolved client-side) is noted as a stronger hardening step if Vercel edge logs become a concern — deferred.

### Files to Create or Modify

New files:

```
src/lib/upload-tokens.ts                          # generate, hash, create, resolve — ~80 LOC
src/lib/upload-session.ts                         # sign/verify httpOnly cookie for /upload/session
src/lib/rate-limit.ts                             # tokenLimiter + globalLimiter + getLimiter (inline is fine too; one file reads cleanly)
src/lib/allowed-types.ts                          # shared content-type allowlist, single source of truth
src/lib/late-upload/handle-completed.ts           # onUploadCompleted fan-out: magic-byte, Zaps, notifications
src/lib/email/payment-receipt.tsx                 # React Email template, client-facing only
src/app/upload/[token]/page.tsx                   # server: validate token → set cookie → 302
src/app/upload/session/page.tsx                   # server: verify cookie → render LateUploadClient
src/components/upload/late-upload-client.tsx      # 'use client' — @vercel/blob/client upload()
src/app/api/late-upload/session/route.ts          # POST handleUpload — cookie-authed
src/app/api/cron/upload-cleanup/route.ts          # GET — weekly Blob cleanup (Vercel Cron)
src/scripts/revoke-upload-token.ts                # CLI — firm lever when a link is reported leaked
```

Modified files:

```
src/app/api/webhooks/stripe/route.ts              # generate token, send receipt, SET NX dedupe
src/lib/kv.ts                                     # export the `redis` singleton
src/lib/zapier.ts                                 # accept URL param so one helper serves all three Zaps
src/types/index.ts                                # add UploadTokenRecord (no version field), UploadSessionCookie
.env.example                                      # document all new env vars
next.config.ts                                    # security headers (Referrer-Policy, Cache-Control, X-Robots-Tag) + Vercel Cron schedule
```

**No** `src/lib/email/send.ts` wrapper (call `resend.emails.send` directly — the wrapper added a dev-mode log but no real value), **no** `src/lib/email/templates/firm-upload-notice.tsx` (plaintext is fine for a one-inbox internal ping), **no** `src/app/upload/[token]/not-found.tsx` (use Next.js's built-in `notFound()`), **no** `upload-log:*` Redis helpers (audit lives in the Google Sheet Zap).

### Environment Variables (new or required)

| Name | Purpose | Required? |
|---|---|---|
| `STRIPE_WEBHOOK_SECRET` | Verify webhook signature (existing var, must be filled) | Yes |
| `BLOB_READ_WRITE_TOKEN` | `@vercel/blob` authorization AND completion-callback HMAC | Yes |
| `ZAPIER_ATTACH_WEBHOOK_URL` | Second Zap: attach file to existing Smokeball matter | Yes |
| `ZAPIER_AUDIT_WEBHOOK_URL` | Third Zap: append event row to firm-owned Google Sheet | Yes |
| `ZAPIER_WEBHOOK_URL` | Existing Zap: create matter | Yes |
| `RESEND_FROM_EMAIL` | e.g. `Aquarius Lawyers <noreply@aquariuslawyers.com.au>` | Yes |
| `FIRM_NOTIFY_EMAIL` | Per-upload firm pings (e.g. `info@aquariuslawyers.com.au`) | Yes |
| `APP_URL` | Base URL for the magic link (server-only — NOT `NEXT_PUBLIC_URL`; the link never renders in client JS) | Yes |
| `UPLOAD_COOKIE_SECRET` | 32-byte random used to HMAC-sign the `au_upload` cookie | Yes |
| `CRON_SECRET` | Shared secret the Vercel Cron job sends to `/api/cron/upload-cleanup` to authorize | Yes |

### Zapier Contracts

#### A. Attach-to-Matter Zap (existing Smokeball integration)

```jsonc
POST $ZAPIER_ATTACH_WEBHOOK_URL
{
  "matter_ref": "s_1744368000000_ab12cd",
  "client_email": "client@example.com",
  "client_name": "Jane Doe",
  "file": {
    "url": "https://<hash>.public.blob.vercel-storage.com/…/charge-sheet.pdf",
    "name": "charge-sheet.pdf",
    "content_type": "application/pdf",
    "size_bytes": 482133
  },
  "uploaded_at": "2026-04-11T23:45:12.033Z",
  "source": "aquarius-chatbot/late-upload"
}
```

Zap steps (firm to configure):

1. Catch Hook.
2. Smokeball — Find Matter (by custom field `matter_ref`, fallback `client_email`).
3. Smokeball — Upload Document to Matter.
4. Filter — skip if file already attached (Smokeball dedupe by filename + hash).

#### B. Audit Zap — Google Sheet (durable trail, APP 11)

```jsonc
POST $ZAPIER_AUDIT_WEBHOOK_URL
{
  "event": "late_upload.completed",
  "matter_ref": "s_1744368000000_ab12cd",
  "client_email": "client@example.com",
  "client_name": "Jane Doe",
  "file_name": "charge-sheet.pdf",
  "file_size_bytes": 482133,
  "file_sha256": "a94a8fef…",
  "attach_zap_status": "ok",
  "uploaded_at": "2026-04-11T23:45:12.033Z",
  "ip_country": "AU"
}
```

Zap steps: Catch Hook → Google Sheets: Append Row. Sheet columns match the JSON keys. Firm owns the sheet and its retention policy. 7-year legal-retention timeframes are the sheet's problem, not Redis'.

**Open question to confirm with firm** during the Smokeball Zapier session: does the firm's Smokeball Zapier integration support "Upload Document to existing Matter" as an action, or only matter creation? If creation-only, fallback is the firm-notification email path (files still land in Blob + audit sheet; firm manually uploads to Smokeball).

### Vercel Blob — Why Client Uploads (not server `put()`)

Next 16 Route Handlers on Vercel have a platform-level **~4.5 MB** request-body cap (confirmed in `@vercel/blob` README and Next 16 docs at `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`). The existing Phase 1 helper at `src/app/api/upload/route.ts:66` uses server `put()`, which silently works for small PDFs but **breaks for anything near the advertised 10 MB limit**. Phase 2 avoids this via `@vercel/blob/client`:

1. Browser calls `upload(fileName, file, { access: 'public', handleUploadUrl: '/api/late-upload/session' })`.
2. `@vercel/blob/client` POSTs a *token-request* body (NOT the file) — tiny, well under 4.5 MB.
3. Route handler verifies the `au_upload` cookie, runs rate limits, then calls `handleUpload` whose `onBeforeGenerateToken` returns allowed types, size cap, and a `tokenPayload` with `matterRef` + `sessionId` (not email/name — those re-read from Redis in the callback).
4. Browser uploads directly to Vercel Blob, bypassing the Lambda body cap.
5. Vercel Blob calls the same route's `onUploadCompleted` with an **HMAC signature verified by `@vercel/blob`'s `handleUpload` using `BLOB_READ_WRITE_TOKEN`**. Forged completion POSTs without the signature return 4xx — tested explicitly in Phase H.

### Rate Limiting (two limiters, three axes)

- **`tokenLimiter`** (`Ratelimit.slidingWindow(20, '1 h')`, prefix `upload-rl:token`) — keyed on `hashToken(token)`. Catches a runaway client or a script replaying one token.
- **`globalLimiter`** (`Ratelimit.slidingWindow(500, '1 h')`, prefix `upload-rl:global`) — keyed on the static string `'global'`. Catches a botnet with many leaked tokens, and catches a bug that accidentally mints many tokens.
- **`getLimiter`** (`Ratelimit.slidingWindow(120, '1 h')`, prefix `upload-rl:get`) — keyed on client IP. Limits GET traffic on `/upload/[token]` (token-guessing) BEFORE cookie auth exists. Per-IP only — POST is already cookie-gated.

All three limiters on POST run through `Promise.all`. The `pending` promise returned by each limiter is passed to Vercel's `waitUntil` so analytics writes complete after the response returns. The old per-token "50 / 7 d total" limiter is dropped — 20/h rolling gives ~3400/week and real clients hit this ceiling only if something is already wrong.

## Implementation Phases

Eight sub-phases collapsed to four to match actual complexity. Day estimates are rough.

### Phase A — Plumbing & Shared Libs (Days 1–2)

**Goal:** Install missing deps, fill env gaps, land reusable libs.

- [x] `npm i @upstash/ratelimit file-type` (both missing from `package.json` — confirmed)
- [x] `npm i @react-email/components` (for the one client-receipt template)
- [x] Refactor `src/lib/kv.ts` to export the `redis` singleton:
      ```ts
      export const redis = new Redis({ … });   // was private
      // existing helpers unchanged
      ```
- [x] Fill `.env.local` values for `STRIPE_WEBHOOK_SECRET`, `BLOB_READ_WRITE_TOKEN`, `ZAPIER_ATTACH_WEBHOOK_URL`, `ZAPIER_AUDIT_WEBHOOK_URL`, `RESEND_FROM_EMAIL`, `FIRM_NOTIFY_EMAIL`, `APP_URL`, `UPLOAD_COOKIE_SECRET` (`openssl rand -base64 32`), `CRON_SECRET`.
  _(Partial: `UPLOAD_COOKIE_SECRET` + `CRON_SECRET` generated; `RESEND_FROM_EMAIL`, `FIRM_NOTIFY_EMAIL`, `APP_URL` defaulted; Stripe/Blob/Zapier TODO markers remain for firm/ops.)_
- [x] Update `.env.example` with all new vars and inline comments.
- [x] Create `src/lib/allowed-types.ts`:
      ```ts
      export const ALLOWED_CONTENT_TYPES = [
        'application/pdf',
        'image/jpeg',
        'image/png',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ] as const;
      export const MAX_BYTES = 10 * 1024 * 1024;
      ```
- [x] Create `src/lib/rate-limit.ts`:
      ```ts
      import { Ratelimit } from '@upstash/ratelimit';
      import { redis } from '@/lib/kv';
      export const tokenLimiter = new Ratelimit({
        redis, limiter: Ratelimit.slidingWindow(20, '1 h'),
        prefix: 'upload-rl:token', analytics: true,
      });
      export const globalLimiter = new Ratelimit({
        redis, limiter: Ratelimit.slidingWindow(500, '1 h'),
        prefix: 'upload-rl:global', analytics: true,
      });
      export const getLimiter = new Ratelimit({
        redis, limiter: Ratelimit.slidingWindow(120, '1 h'),
        prefix: 'upload-rl:get', analytics: true,
      });
      ```
- [x] Add types to `src/types/index.ts`:
      ```ts
      export interface UploadTokenRecord {
        matterRef: string;
        clientEmail: string;
        clientName: string;
        sessionId: string;
        createdAt: string;   // ISO
      }
      export interface UploadSessionCookie {
        matterRef: string;
        sessionId: string;
        exp: number;         // unix seconds
      }
      ```
- [x] Create `src/lib/upload-tokens.ts`:
      ```ts
      import crypto from 'node:crypto';
      import { redis } from '@/lib/kv';
      import type { UploadTokenRecord } from '@/types';

      const TTL = 60 * 60 * 24 * 7;          // 7 d
      const PREFIX = 'upload-token:';
      const MIN_TOKEN_LENGTH = 32;            // base64url of 32 bytes is 43 chars; < 32 is always malformed

      function generateRawToken() {
        return crypto.randomBytes(32).toString('base64url');
      }
      export function hashToken(raw: string) {
        return crypto.createHash('sha256').update(raw).digest('hex');
      }

      export async function createUploadToken(
        input: Omit<UploadTokenRecord, 'createdAt'>
      ): Promise<{ rawToken: string; record: UploadTokenRecord }> {
        const rawToken = generateRawToken();
        const record: UploadTokenRecord = { ...input, createdAt: new Date().toISOString() };
        await redis.set(`${PREFIX}${hashToken(rawToken)}`, record, { ex: TTL });
        return { rawToken, record };
      }

      export async function resolveUploadToken(
        rawToken: string
      ): Promise<{ record: UploadTokenRecord; tokenHash: string } | null> {
        if (!rawToken || rawToken.length < MIN_TOKEN_LENGTH) return null;
        const tokenHash = hashToken(rawToken);
        const record = await redis.get<UploadTokenRecord>(`${PREFIX}${tokenHash}`);
        return record ? { record, tokenHash } : null;
      }

      export async function revokeUploadToken(rawToken: string): Promise<void> {
        await redis.del(`${PREFIX}${hashToken(rawToken)}`);
      }
      export async function revokeTokenByHash(tokenHash: string): Promise<void> {
        await redis.del(`${PREFIX}${tokenHash}`);
      }
      ```
- [x] Create `src/lib/upload-session.ts` — sign/verify the `au_upload` httpOnly cookie:
      ```ts
      import crypto from 'node:crypto';
      import type { UploadSessionCookie } from '@/types';

      const SECRET = process.env.UPLOAD_COOKIE_SECRET!;
      const COOKIE_NAME = 'au_upload' as const;

      export function signCookie(payload: UploadSessionCookie): string {
        const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
        const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
        return `${body}.${sig}`;
      }
      export function verifyCookie(cookie: string | undefined): UploadSessionCookie | null {
        if (!cookie) return null;
        const [body, sig] = cookie.split('.');
        if (!body || !sig) return null;
        const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
        if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as UploadSessionCookie;
        if (payload.exp < Math.floor(Date.now() / 1000)) return null;
        return payload;
      }
      export { COOKIE_NAME };
      ```
- [x] Modify `src/lib/zapier.ts` to accept a URL parameter so one helper serves all three Zaps:
      ```ts
      export async function sendToZapier(url: string, payload: Record<string, unknown>): Promise<void> { … }
      ```
- [x] Commit. Run `npm run build` and `npm run lint` — both must pass, no behavioral changes yet.
  _(Deferred to end-of-plan: single atomic commit covers A→D.)_

**Success criteria:** `npm run build` + `npm run lint` green; env documented; `createUploadToken` + `resolveUploadToken` + `signCookie` + `verifyCookie` exist and are callable from a unit test; no user-visible changes.

### Phase B — Stripe Webhook, Receipt Email, Retry Dedupe (Days 2–3)

**Goal:** On `checkout.session.completed`, idempotently mint a token and email the client a Resend receipt with the magic link.

- [ ] Create `src/lib/email/payment-receipt.tsx` — React Email component:
      - Takes `{ name?: string; matterRef: string; amountCents: number; uploadLink: string }`
      - Greeting: `{name ? \`Hi ${name}\` : 'Hello'}` — fallback lives in the template, not the caller
      - Payment confirmation block with formatted currency
      - Prominent CTA button → `uploadLink`
      - Footer: "This link stays valid for 7 days and can be used multiple times."
      - **NO** `<img>` tags, `<link rel="preload">`, `UTM` params, or any URL other than the magic link (enforced by a unit test that parses the rendered HTML)
- [ ] Modify `src/app/api/webhooks/stripe/route.ts` — after the existing `updateSession` call:
      ```ts
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const sessionId = session.metadata?.sessionId;
        const clientEmail = session.customer_details?.email ?? session.customer_email;
        const clientName  = session.customer_details?.name ?? '';
        if (sessionId && clientEmail) {
          try {
            // RETRY DEDUPE — first-class task (was SpecFlow prose)
            const dedupeKey = `stripe-session:${session.id}`;
            // SET NX: returns 'OK' if created, null if already present
            const created = await redis.set(dedupeKey, 'pending', { nx: true, ex: 60 * 60 * 24 * 7 });
            if (created !== 'OK') {
              // Retry: re-mint NO new token. Re-send the same email ONLY if the prior
              // attempt stored the hash; otherwise skip — client already has the link.
              console.info(`[stripe-webhook] retry ignored for ${session.id}`);
              return NextResponse.json({ received: true });
            }
            const { rawToken, record } = await createUploadToken({
              matterRef: sessionId, clientEmail, clientName, sessionId,
            });
            // Store the hash so the dedupe key doubles as an audit pointer
            await redis.set(dedupeKey, hashToken(rawToken), { ex: 60 * 60 * 24 * 7 });
            const link = `${process.env.APP_URL}/upload/${rawToken}`;
            await resend.emails.send({
              from: process.env.RESEND_FROM_EMAIL!,
              to: clientEmail,
              subject: 'Your payment receipt — Aquarius Lawyers',
              react: PaymentReceipt({ name: clientName, matterRef: sessionId, amountCents: session.amount_total ?? 0, uploadLink: link }),
            });
          } catch (err) {
            // Webhook MUST return 200 regardless — otherwise Stripe retries and we dupe
            console.error('[stripe-webhook] token/email fan-out failed', { stripeSessionId: session.id, err });
          }
        }
      }
      return NextResponse.json({ received: true });
      ```
- [ ] **Confirm signature verification is unconditional** — read `src/app/api/webhooks/stripe/route.ts` and assert there is no `NODE_ENV === 'development'` bypass of `constructEvent`. Forged `checkout.session.completed` = attacker-minted token to arbitrary email.
- [ ] **Resend tracking assertion** — add a startup check (inside `src/lib/resend.ts` or a new `src/lib/email/assert-no-tracking.ts`) that fails loud if the Resend domain has click/open tracking enabled. Resend rewriting the magic link through `track.resend.com/<id>/<encoded>` would leak the token to Resend and every intermediate proxy. Use `resend.domains.get()` at boot in production; log a warning and fail the first webhook call if tracking is on.
- [ ] **PII discipline** — never log `rawToken`, `clientEmail`, or `clientName` at `info` level. At `error` level only, include the Stripe session ID and the first 8 hex of `hashToken(rawToken)` for grep-ability.
- [ ] Unit test: payment-receipt template renders with and without `name`, contains exactly one outbound URL (the magic link), and zero `<img>` tags.

**Success criteria:** Stripe test-mode payment → Resend email in dashboard with a valid link → `/upload/<token>` resolves to the correct record → triggering the webhook twice results in only one token and one email.

### Phase C — Upload UI: Cookie Redirect + Page + Client Component (Days 3–5)

**Goal:** Render the upload UI behind a signed cookie, so the raw token never enters the browser URL bar.

- [ ] Create `src/app/upload/[token]/page.tsx`:
      ```tsx
      import { notFound, redirect } from 'next/navigation';
      import { cookies, headers } from 'next/headers';
      import { resolveUploadToken } from '@/lib/upload-tokens';
      import { getLimiter } from '@/lib/rate-limit';
      import { signCookie, COOKIE_NAME } from '@/lib/upload-session';

      export const dynamic = 'force-dynamic';

      export default async function Page(
        { params }: { params: Promise<{ token: string }> }
      ) {
        // GET rate limit (pre-auth; protects against token guessing)
        const h = await headers();
        const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim();
        if (!ip) notFound();   // no fallback bucket — refuse opaque traffic
        const { success } = await getLimiter.limit(ip);
        if (!success) notFound();

        const { token } = await params;
        const resolved = await resolveUploadToken(token);
        if (!resolved) notFound();

        const { record } = resolved;
        const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7;
        const cookieStore = await cookies();
        cookieStore.set(COOKIE_NAME, signCookie({
          matterRef: record.matterRef, sessionId: record.sessionId, exp,
        }), { httpOnly: true, secure: true, sameSite: 'lax', path: '/upload', maxAge: 60 * 60 * 24 * 7 });
        redirect('/upload/session');
      }

      export const metadata = {
        title: 'Upload your documents — Aquarius Lawyers',
        robots: { index: false, follow: false },
        referrer: 'no-referrer' as const,
      };
      ```
- [ ] Create `src/app/upload/session/page.tsx`:
      ```tsx
      import { notFound } from 'next/navigation';
      import { cookies } from 'next/headers';
      import { verifyCookie, COOKIE_NAME } from '@/lib/upload-session';
      import { LateUploadClient } from '@/components/upload/late-upload-client';

      export const dynamic = 'force-dynamic';

      export default async function Page() {
        const cookieStore = await cookies();
        const raw = cookieStore.get(COOKIE_NAME)?.value;
        const session = verifyCookie(raw);
        if (!session) notFound();
        return <LateUploadClient matterRef={session.matterRef} />;
      }
      ```
- [ ] Create `src/components/upload/late-upload-client.tsx`:
      - `'use client'`
      - Renders header + short APP-5 notice ("Files uploaded here are sent securely to Aquarius Lawyers and stored in Smokeball. See our Privacy Policy.")
      - Uses `upload()` from `@vercel/blob/client` with `handleUploadUrl: '/api/late-upload/session'`
      - No `clientPayload` — the route handler reads everything it needs from the cookie
      - Per-file progress, success, retry states; multi-file; "Add more files" after each success
      - Reuses `--color-brand`, Rubik/Open Sans, and the drag-drop chrome from `src/components/upload/document-upload.tsx` by extracting the presentational drop zone into a shared component if it saves real LOC — otherwise copy it
      - `min-h-[44px]` touch targets, `aria-live="polite"` status region
- [ ] Configure `next.config.ts` headers:
      ```ts
      async headers() {
        return [
          { source: '/upload/:path*', headers: [
            { key: 'Referrer-Policy', value: 'no-referrer' },
            { key: 'Cache-Control', value: 'no-store, private' },
            { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          ]},
          { source: '/api/late-upload/:path*', headers: [
            { key: 'Cache-Control', value: 'no-store' },
          ]},
        ];
      }
      ```
- [ ] Add a small request-log scrubber (or document that Next.js App Router default logging doesn't print query/path at info level) so the raw token path doesn't appear in app logs. Vercel edge logs will still see it on the initial GET — this is the gap fragment-based tokens would close; deferred.

**Success criteria:** Valid link 302s to `/upload/session` with `Set-Cookie`; `/upload/session` renders upload UI; visiting `/upload/session` without a valid cookie 404s; expired/invalid token on the first GET 404s; 121st GET from one IP in an hour 404s.

### Phase D — Upload API, Fan-out Handler, Audit Zap, Notifications, Revocation CLI, Cleanup Cron (Days 5–7)

**Goal:** Everything after the user clicks "upload" — through to Smokeball, audit sheet, and inboxes — plus the two operational levers.

- [ ] Create `src/app/api/late-upload/session/route.ts`:
      ```ts
      import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
      import { NextResponse } from 'next/server';
      import type { NextRequest } from 'next/server';
      import { cookies } from 'next/headers';
      import { z } from 'zod';
      import { verifyCookie, COOKIE_NAME } from '@/lib/upload-session';
      import { tokenLimiter, globalLimiter } from '@/lib/rate-limit';
      import { hashToken } from '@/lib/upload-tokens';
      import { ALLOWED_CONTENT_TYPES, MAX_BYTES } from '@/lib/allowed-types';
      import { handleUploadCompleted } from '@/lib/late-upload/handle-completed';

      export const runtime = 'nodejs';
      export const maxDuration = 15;   // token signing + await Promise.all — not a byte pusher
      export const preferredRegion = 'syd1';

      const TokenPayloadSchema = z.object({ matterRef: z.string().min(1), sessionId: z.string().min(1) });

      export async function POST(request: NextRequest) {
        const cookieStore = await cookies();
        const session = verifyCookie(cookieStore.get(COOKIE_NAME)?.value);
        if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

        // Token-scoped + global limiters in parallel (Kieran: no sequential awaits)
        const tokenKey = hashToken(session.sessionId);   // cookie is bound to sessionId
        const [tk, gl] = await Promise.all([
          tokenLimiter.limit(tokenKey),
          globalLimiter.limit('global'),
        ]);
        // Background analytics writes
        void Promise.all([tk.pending, gl.pending]);
        if (!tk.success || !gl.success) {
          return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
        }

        const body = (await request.json()) as HandleUploadBody;
        try {
          const json = await handleUpload({
            body,
            request,
            onBeforeGenerateToken: async () => {
              // Extra path entropy: prefix with 16 hex of sessionId hash → full path has 256+ bits of unguessability
              const prefix = tokenKey.slice(0, 16);
              return {
                allowedContentTypes: [...ALLOWED_CONTENT_TYPES],
                maximumSizeInBytes: MAX_BYTES,
                addRandomSuffix: true,
                tokenPayload: JSON.stringify({
                  matterRef: session.matterRef, sessionId: session.sessionId,
                }),
                // pathname prefix encoded by the client via a clientPayload convention if supported;
                // otherwise enforce pathname shape in onUploadCompleted and del() on mismatch
              };
            },
            onUploadCompleted: async ({ blob, tokenPayload }) => {
              // HMAC-verified by @vercel/blob — forged posts fail before reaching this callback
              const parsed = TokenPayloadSchema.parse(JSON.parse(tokenPayload ?? '{}'));
              await handleUploadCompleted({ blob, ...parsed });
            },
          });
          return NextResponse.json(json);
        } catch (err) {
          console.error('[late-upload] handleUpload error', err);
          return NextResponse.json({ error: 'upload_failed' }, { status: 500 });
        }
      }
      ```
- [ ] Create `src/lib/late-upload/handle-completed.ts`:
      ```ts
      import type { PutBlobResult } from '@vercel/blob';
      import { del } from '@vercel/blob';
      import { fileTypeFromBuffer } from 'file-type';
      import { Resend } from 'resend';
      import { sendToZapier } from '@/lib/zapier';
      import { redis } from '@/lib/kv';
      import { ALLOWED_CONTENT_TYPES } from '@/lib/allowed-types';
      import type { UploadTokenRecord } from '@/types';

      const resend = new Resend(process.env.RESEND_API_KEY!);
      const UPLOAD_TOKEN_PREFIX = 'upload-token:';

      export async function handleUploadCompleted(args: {
        blob: PutBlobResult; matterRef: string; sessionId: string;
      }) {
        const { blob, matterRef, sessionId } = args;

        // Look up the client record (never trust tokenPayload for PII — re-read)
        // We stored tokenHash in stripe-session:<id> → use sessionId to walk back
        const record = await lookupRecordBySessionId(sessionId);
        if (!record) {
          console.error('[late-upload] record missing on completion', { sessionId });
          await del(blob.url);
          return;
        }

        // 1. Magic-byte check — fetch first 4 KB of the blob
        const head = await fetch(blob.url, { headers: { Range: 'bytes=0-4095' } });
        const buf = Buffer.from(await head.arrayBuffer());
        const detected = await fileTypeFromBuffer(buf);
        const declaredOk = ALLOWED_CONTENT_TYPES.includes(blob.contentType as typeof ALLOWED_CONTENT_TYPES[number]);
        const detectedOk = detected ? ALLOWED_CONTENT_TYPES.includes(detected.mime as typeof ALLOWED_CONTENT_TYPES[number]) : false;
        if (!declaredOk || !detectedOk || (detected && detected.mime !== blob.contentType)) {
          console.error('[late-upload] magic-byte mismatch — deleting blob', {
            matterRef, declared: blob.contentType, detected: detected?.mime,
          });
          await del(blob.url);
          return;
        }

        const uploadedAt = new Date().toISOString();
        const fileName = blob.pathname.split('/').pop() ?? 'file';

        // 2. Smokeball attach Zap
        let attachZapStatus: 'ok' | 'failed' = 'ok';
        try {
          await sendToZapier(process.env.ZAPIER_ATTACH_WEBHOOK_URL!, {
            matter_ref: matterRef,
            client_email: record.clientEmail,
            client_name: record.clientName,
            file: { url: blob.url, name: fileName, content_type: blob.contentType, size_bytes: buf.length /* replace with real size */ },
            uploaded_at: uploadedAt,
            source: 'aquarius-chatbot/late-upload',
          });
        } catch (err) {
          attachZapStatus = 'failed';
          console.error('[late-upload] attach zap failed', err);
        }

        // 3. Durable audit Zap — Google Sheet (APP 11)
        try {
          await sendToZapier(process.env.ZAPIER_AUDIT_WEBHOOK_URL!, {
            event: 'late_upload.completed',
            matter_ref: matterRef,
            client_email: record.clientEmail,
            client_name: record.clientName,
            file_name: fileName,
            file_size_bytes: buf.length /* replace with real size */,
            attach_zap_status: attachZapStatus,
            uploaded_at: uploadedAt,
          });
        } catch (err) {
          console.error('[late-upload] audit zap failed', err);
        }

        // 4. Firm notification (plaintext — no template file)
        try {
          await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL!,
            to: process.env.FIRM_NOTIFY_EMAIL!,
            subject: `[Upload${attachZapStatus === 'failed' ? ' — MANUAL REQUIRED' : ''}] ${record.clientName || 'Client'} — ${fileName}`,
            text: [
              `Client: ${record.clientName || '(no name)'} <${record.clientEmail}>`,
              `Matter ref: ${matterRef}`,
              `File: ${fileName} (${blob.contentType})`,
              `URL: ${blob.url}`,
              `Smokeball Zap status: ${attachZapStatus}`,
              `Uploaded at: ${uploadedAt}`,
            ].join('\n'),
          });
        } catch (err) {
          console.error('[late-upload] firm notify failed', err);
        }

        // 5. Client confirmation — out-of-band tripwire for token misuse
        try {
          await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL!,
            to: record.clientEmail,
            subject: 'We received a file for your matter',
            text: [
              `Hi ${record.clientName || 'there'},`,
              '',
              `We just received "${fileName}" for your matter at Aquarius Lawyers.`,
              'If this wasn\'t you, please reply to this email immediately so we can secure your upload link.',
            ].join('\n'),
          });
        } catch (err) {
          console.error('[late-upload] client notify failed', err);
        }
      }

      async function lookupRecordBySessionId(sessionId: string): Promise<UploadTokenRecord | null> {
        // Read the Stripe dedupe key → tokenHash → upload-token record
        const tokenHash = await redis.get<string>(`stripe-session:${sessionId}`);
        if (!tokenHash || tokenHash === 'pending') return null;
        return redis.get<UploadTokenRecord>(`${UPLOAD_TOKEN_PREFIX}${tokenHash}`);
      }
      ```
- [ ] Create `src/scripts/revoke-upload-token.ts`:
      ```ts
      // Usage: CRON_SECRET=… npx tsx src/scripts/revoke-upload-token.ts --session s_1744368000000_ab12cd
      import { redis } from '@/lib/kv';
      import { revokeTokenByHash } from '@/lib/upload-tokens';

      const sessionId = process.argv.find((a, i) => process.argv[i - 1] === '--session');
      if (!sessionId) { console.error('usage: --session <id>'); process.exit(1); }
      const tokenHash = await redis.get<string>(`stripe-session:${sessionId}`);
      if (!tokenHash || tokenHash === 'pending') { console.error('no active token for session'); process.exit(2); }
      await revokeTokenByHash(tokenHash);
      await redis.del(`stripe-session:${sessionId}`);
      console.log(`revoked token for session ${sessionId}`);
      ```
- [ ] Create `src/app/api/cron/upload-cleanup/route.ts` — weekly Blob cleanup (Vercel Cron):
      ```ts
      import { list, del } from '@vercel/blob';
      import { NextResponse } from 'next/server';
      import type { NextRequest } from 'next/server';

      export const runtime = 'nodejs';
      export const maxDuration = 60;

      const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;   // 30 days

      export async function GET(request: NextRequest) {
        if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
          return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
        }
        const cutoff = Date.now() - RETENTION_MS;
        let cursor: string | undefined;
        let deleted = 0;
        do {
          const page = await list({ cursor, limit: 1000 });
          const stale = page.blobs.filter(b => new Date(b.uploadedAt).getTime() < cutoff);
          if (stale.length) {
            await del(stale.map(b => b.url));
            deleted += stale.length;
          }
          cursor = page.cursor;
        } while (cursor);
        return NextResponse.json({ deleted });
      }
      ```
- [ ] Add Vercel Cron config to `vercel.json` (new file if not present):
      ```json
      { "crons": [{ "path": "/api/cron/upload-cleanup", "schedule": "0 3 * * 0" }] }
      ```
- [ ] Add `tsx` as a devDependency if not already present (for the revoke script).

**Success criteria:** End-to-end upload → blob in Vercel Blob dashboard → attach Zap fires → audit Zap appends a row to the Google Sheet → firm email arrives → client email arrives → revocation CLI blanks the token in Redis → subsequent attempts on the same session 401.

### Phase E — Security, Privacy, Testing, Docs (Days 7–9)

**Goal:** Apply OWASP + APP 11 hygiene and run the test matrix.

- [ ] **PII redaction audit**: grep new files for `clientEmail`, `email`, `name`, `token`; confirm these never reach `console.log`/`console.info` outside `error` level.
- [ ] **Resend tracking runtime assertion** (from Phase B): verified to fail loud in production if tracking is re-enabled. Add a CI check that imports and calls the assertion as a smoke test.
- [ ] **Forged-callback test** — integration test that POSTs a `blob.upload-completed` body to `/api/late-upload/session` without a valid `@vercel/blob` HMAC and asserts the request is rejected. Documents the trust boundary.
- [ ] **Revocation CLI test** — create a token, run the CLI, confirm Redis key is gone and subsequent uploads 401.
- [ ] **Blob cleanup test** — manually seed a blob with an old `uploadedAt`, hit the cron endpoint with the correct `CRON_SECRET`, confirm deletion.
- [ ] **Magic-byte test** — upload a PDF renamed to `.docx`, upload a PHP file renamed to `.pdf`; confirm both are `del()`ed and no Zap fires.
- [ ] **Multi-use test** — hit the link twice, upload different files each time, both reach Smokeball.
- [ ] **Rate-limit tests**:
      - 21 uploads in <1 h with the same cookie → 21st returns 429
      - 121 GETs to `/upload/<token>` from one IP in <1 h → 121st 404s
      - Global limiter saturated → 500 requests pass, 501st 429
- [ ] **Stripe retry dedupe test** — fire the same `checkout.session.completed` event twice, confirm only one token is minted and only one email sent.
- [ ] **Scanner pre-fetch test** — open the URL in a private window, don't submit anything: confirm state is mutated (cookie set — unavoidable) but multi-use semantics aren't burned.
- [ ] **Email inbox test** — send to Gmail, O365 (Safe Links), Apple Mail; confirm the link opens cleanly.
- [ ] **Mobile a11y test** — complete a full upload on iOS Safari + Android Chrome.
- [ ] **Forwarded-link test** — simulate a client forwarding the link; confirm: (a) the second user can upload, (b) per-IP GET limiter slows down aggressive reuse, (c) client notification emails fire on each upload, (d) revocation CLI shuts the whole thing down.
- [ ] **Unit test**: payment-receipt template has exactly one outbound URL, zero `<img>` tags, and exactly zero `UTM`-style query params.
- [ ] Update `README.md` with the feature's operational runbook: the revoke command, the cron schedule, where the audit sheet lives.

**Success criteria:** All tests above pass; firm has confirmed the attach Zap **and** the audit Zap are wired in Zapier; APP-5 notice copy + privacy-policy update are reviewed by firm/counsel.

## SpecFlow Analysis (inline)

| User state | What happens | Covered by |
|---|---|---|
| Client pays, never clicks link | Token expires silently after 7 d | Redis TTL (Phase A) |
| Client clicks link, uploads 0 files | GET 302s, cookie set, `/upload/session` renders; no state change on Blob/Zap | Phase C |
| Client clicks link, uploads 3 files, returns next day | Cookie has 7-d `maxAge`; re-clicking the email sets a fresh cookie anyway | Phase C |
| Client forwards the link to a friend | Friend can upload once before client gets the notification email; revocation CLI is the lever | Phase D (client notify + revoke) |
| Email scanner (Mimecast/Safe Links) pre-fetches | First GET sets a cookie in the scanner's session; no upload happens; per-IP getLimiter catches repeat fetches | Phase C |
| Stripe retries the webhook | `SET NX stripe-session:<id>` short-circuits the retry | Phase B |
| 11 MB file | Rejected by Blob upload token's `maximumSizeInBytes` | Phase D |
| PDF with `.php` contents declared `application/pdf` | Magic-byte check fails in `onUploadCompleted`, blob is `del()`ed, no Zap fires | Phase D |
| PDF declared as `image/png` | `allowedContentTypes` is fine with `image/png` but magic-byte disagrees with declared → `del()` | Phase D |
| Zap is broken / down | Attach Zap status = `failed`, firm email flagged `[MANUAL REQUIRED]`, audit row still written | Phase D |
| Zapier → Smokeball doesn't support the attach action | Fallback is the firm-notification email + the blob URL (manual upload) | Phase D |
| Blob URL guessable | `addRandomSuffix: true` + 64-bit path prefix from `hashToken(sessionId).slice(0,16)` = 256+ bits total | Phase D |
| Token leaked via browser history | GET 302s to `/upload/session`; only `/upload/session` is in history after the redirect | Phase C |
| Token leaked via referrer | `Referrer-Policy: no-referrer` on all `/upload/*` routes | Phase C |
| Token in Vercel edge logs on first GET | Known residual exposure; compensating controls: (a) small team has dashboard access only, (b) per-token rate limit catches replay, (c) revocation CLI, (d) deferred fragment-based hardening documented | Risks |
| Browser extension reads `tab.url` before `useEffect` runs | Cookie redirect model means `useEffect` never needs to scrub anything; the upload UI lives at `/upload/session` | Phase C |
| Matter ID not in Stripe metadata | `matterRef = sessionId` — already present at checkout session creation | Prerequisites |
| Redis outage | Token resolution fails → 404 → client retries when Redis is back; Stripe webhook is idempotent once Redis recovers | Risks |

## Acceptance Criteria

### Functional

- [ ] A paying client receives a Resend email containing `https://<domain>/upload/<token>` within 60 s of successful Stripe checkout.
- [ ] Webhook retries do not produce duplicate tokens or duplicate receipt emails.
- [ ] Clicking the link: the raw token appears in the URL bar for ≤1 request, then the user lands on `/upload/session` with no token visible.
- [ ] `/upload/session` renders a drag-drop area reusing Phase 1's visual language.
- [ ] Uploaded PDF/JPG/PNG/DOCX files up to 10 MB each are accepted. Anything else is rejected at `onBeforeGenerateToken` (size/type) AND at `onUploadCompleted` (magic-byte).
- [ ] Magic-byte mismatches result in the blob being `del()`ed and no Zap firing.
- [ ] Each successful upload fires the attach Zap, the audit Zap, a firm notification email, AND a client confirmation email.
- [ ] The link continues to work for 7 days across multiple visits. The cookie's 7-day `maxAge` matches the token TTL.
- [ ] Invalid / expired / tampered token returns a 404, no 500s.
- [ ] The revocation CLI kills an active session's token in one command.
- [ ] The Vercel Cron `del()`s blobs older than 30 days.

### Non-functional

- [ ] No raw tokens, client emails, or client names appear in server logs at `info` level.
- [ ] Response headers on `/upload/*`: `Referrer-Policy: no-referrer`, `Cache-Control: no-store, private`, `X-Robots-Tag: noindex, nofollow`.
- [ ] Upload rate limits: 20 / h / token, 500 / h global (POST); 120 / h / IP (GET).
- [ ] Session cookie is `httpOnly`, `secure`, `sameSite: 'lax'`, path-scoped to `/upload`.
- [ ] `maxDuration = 15` on the upload route; `Promise.all` on rate limiters.
- [ ] Blob path includes a 64-bit prefix derived from `hashToken(sessionId).slice(0,16)`.
- [ ] Resend tracking runtime assertion blocks the webhook if tracking is re-enabled.
- [ ] `npm run build` and `npm run lint` pass.

### Quality gates

- [ ] All Phase E tests executed and documented.
- [ ] Firm has confirmed BOTH Zaps (attach + audit) are wired and fire against mock data.
- [ ] Firm's privacy policy has been updated with Vercel Blob (US region) APP 8 cross-border disclosure language, reviewed by counsel.
- [ ] Collection-notice copy on `/upload/session` reviewed by the firm.

## Edge Cases & Mitigations (consolidated)

| Edge case | Mitigation |
|---|---|
| Stripe webhook retries | `SET NX stripe-session:<id>` dedupe with 7-d TTL |
| Email scanner pre-fetch | Multi-use token + idempotent GET + getLimiter |
| O365 Safe Links rewrite | Tested in Phase E; token survives as query passthrough |
| Forwarded link | Client notification email + revocation CLI + per-IP GET limiter |
| Browser extension reads `tab.url` | Cookie redirect means the token is on the URL for ~1 request; upload UI is token-free |
| Vercel edge logs capture first GET URL | Documented residual risk; fragment-based hardening deferred |
| PHP-as-PDF phishing | Magic-byte check + `del()` on mismatch |
| File > 10 MB | `maximumSizeInBytes` enforced by Blob upload service |
| Blob region = iad1 (US) | APP 8 cross-border disclosure documented in privacy policy |
| Forged `onUploadCompleted` POST | `@vercel/blob`'s `handleUpload` HMAC-verifies via `BLOB_READ_WRITE_TOKEN`; Phase E integration test |
| Resend click-tracking re-enabled | Runtime startup assertion fails loud |
| Concurrent `onUploadCompleted` races | No shared mutable state in `handle-completed.ts`; each upload is independent (audit log is append-only via Google Sheet) |
| Redis outage | 404 on resolve → client retries; Stripe webhook retries are idempotent via SET NX |
| Phase 1 latent 4.5 MB cap bug | Back-port this plan's client-upload flow to `/api/upload/route.ts` — **deferred** to a follow-up |

## Dependencies & Prerequisites

- Phase 1 must be shipped. Phase 1's `src/app/api/checkout/route.ts` must set `metadata.sessionId` on the Stripe checkout session — confirmed.
- `@upstash/ratelimit` and `file-type` must be installed (Phase A step 1).
- Firm must configure **two new Zaps** in Zapier: (a) "Attach File to Smokeball Matter", (b) "Append Upload to Google Sheet". Both are external dependencies.
- Resend sender domain must be verified with SPF/DKIM/DMARC records live AND click/open tracking must be OFF (runtime-asserted).
- `BLOB_READ_WRITE_TOKEN`, `UPLOAD_COOKIE_SECRET`, `CRON_SECRET` must be provisioned in Vercel and mirrored in `.env.local` for dev.
- `APP_URL` must be the production domain when production webhooks fire.

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Smokeball Zap lacks "attach to existing matter" action | Files land but don't attach automatically | Med | Firm-notification email is manual fallback; audit sheet still captures everything |
| Vercel Blob stores in `iad1` (US) → APP 8 cross-border | Privacy policy update required | Med | Counsel-reviewed policy text before launch |
| Vercel edge logs retain the raw token on the first GET | Internal log exposure | Low-Med | Small-team dashboard access; revocation CLI; fragment-based hardening deferred if it becomes load-bearing |
| React Email / `@vercel/blob/client` API drift | Build break on update | Low | Pin versions; add to dependabot review list |
| Phase 1 latent 4.5 MB Lambda cap bug on in-chat upload | In-chat uploads silently fail for larger files | High | Back-port this plan's client-upload flow — **separate follow-up** |
| Webhook runs but email send fails (Resend outage) | Client pays, gets no link | Med | Wrap in try/catch; log Stripe session ID + token hash prefix; manual resend CLI is a trivial follow-up |
| Token entropy accidentally reduced in a future refactor | Token guessing becomes feasible | Low | Constant + unit test asserting `randomBytes(32)` |
| Resend click tracking re-enabled by a future admin | Magic link leaks to Resend | Low | Runtime assertion at boot |
| `file-type` misses a crafted polyglot | Malicious file lands in Smokeball | Low | Smokeball's own AV is the second layer; firm's manual review is the third |

## Deferred Work (NOT in this plan)

- **Fragment-based token** (`/upload#<token>` + client bootstrap) — stronger residual log hygiene; revisit if Vercel edge log exposure becomes a compliance issue
- Back-port client-upload flow to Phase 1's in-chat upload (`/api/upload/route.ts`)
- Debounced "digest" firm notifications instead of per-event
- CLI to manually re-trigger a receipt email after a Resend outage
- Structured logger (pino with PII redact) — current plan relies on discipline + code review
- Two-way Smokeball API integration
- VirusTotal hash lookup in addition to `file-type` magic-byte check
- Admin web UI for revocation (CLI is sufficient for launch)

## References & Research

### Internal (this repo)

- Brainstorm: `docs/brainstorms/2026-04-11-late-document-upload-brainstorm.md`
- Phase 1 plan: `docs/plans/2026-04-10-feat-criminal-law-chatbot-phase1-plan.md`
- Existing Stripe webhook: `src/app/api/webhooks/stripe/route.ts:1-49`
- Existing Upstash wrapper: `src/lib/kv.ts:1-57`
- Existing Blob upload (latent 4.5 MB bug): `src/app/api/upload/route.ts:66-70`
- Existing Zapier helper: `src/lib/zapier.ts:1-22`
- Upload component to share/fork: `src/components/upload/document-upload.tsx`
- Validators: `src/lib/validators.ts`
- Brand tokens + fonts: `src/app/layout.tsx`, `src/app/globals.css`
- Session types: `src/types/index.ts:8-21`

### Framework docs (`node_modules/next/dist/docs/` — Next.js 16.2.3)

- Route handlers (`route.md`) — `params: Promise<…>`, `request.formData()` surfaces `File`, no `bodyParser` needed
- Route segment config (`index.md`, `runtime.md`, `maxDuration.md`) — supported exports in v16: `dynamicParams`, `runtime`, `preferredRegion`, `maxDuration`
- Page conventions (`page.md`) — `PageProps<'/route'>`, `RouteContext<'/route'>` globals
- `serverActions.bodySizeLimit` applies ONLY to Server Actions

### External (2026)

- Next.js Route Handlers: https://nextjs.org/docs/app/api-reference/file-conventions/route
- Next.js Route Segment Config: https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config
- `@vercel/blob` client uploads + 4.5 MB cap: https://vercel.com/docs/vercel-blob/client-upload
- `@vercel/blob` multipart 5 TB: https://vercel.com/changelog/5tb-file-transfers-with-vercel-blob-multipart-uploads
- `@upstash/ratelimit`: https://upstash.com/docs/redis/sdks/ratelimit-ts/algorithms
- `file-type` npm: https://www.npmjs.com/package/file-type
- Stripe webhooks (raw body rule): https://github.com/stripe/stripe-node
- Resend send API: https://resend.com/docs/api-reference/emails/send-email
- OWASP Cryptographic Storage: https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html
- OWASP Insecure Randomness: https://owasp.org/www-community/vulnerabilities/Insecure_Randomness
- OAIC APP 11: https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-11-app-11-security-of-personal-information
- OAIC Australian Privacy Principles: https://www.oaic.gov.au/privacy/australian-privacy-principles/read-the-australian-privacy-principles

---

**End of plan.**
