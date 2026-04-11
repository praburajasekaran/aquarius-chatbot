---
date: 2026-04-11
topic: late-document-upload
---

# Late Document Upload — Post-Chat File Delivery

## What We're Building

A way for paying clients to upload documents (charge sheets, court papers, photos) **after** closing the chat session, with those files still landing on the correct Smokeball matter. Today the chat offers "Yes, I have documents to upload" vs "No, I'll do it later" — but "later" has no actual mechanism behind it. This feature builds that mechanism.

The flow: every paid client receives their Stripe receipt email with a tokenized upload link. Clicking it opens a lightweight upload page tied to their existing matter. Files uploaded there are attached to the Smokeball matter via a dedicated Zap and the firm receives an email notification for each upload event. Link stays valid for 7 days and supports multiple visits.

## Why This Approach

**Considered:**
- **Magic link in receipt email** (chosen) — zero-friction identification, leverages the email they already gave, no password or account.
- **Reference code + email verify** — extra step for the client, more typing, higher drop-off.
- **Full client portal** — massive overkill for a one-time intake upload.
- **Smokeball as source of truth** — cleanest but requires two-way Smokeball API access, which the firm doesn't have today (Zapier is one-way).

**Why magic link + separate 7-day Redis namespace wins:** it respects the existing 1hr chat-session TTL (chat data still auto-expires for privacy), adds only one new Redis key pattern, and reuses the same Zapier-to-Smokeball pipeline Phase 1 already established. No new infrastructure.

## Key Decisions

- **Identification: email magic link.** Tokenized URL sent in the payment receipt. No login, no code entry. — Lowest friction for a one-time intake task.
- **Link lifetime: 7 days.** Long enough to gather court documents, short enough to avoid stale-token hygiene issues. — Matches typical legal intake pacing.
- **Delivery to Smokeball: Zapier attach + email ping.** A second Zap attaches files to the existing matter via stored matter ID; firm also gets an email so staff know to look. — Automation with a human safety net.
- **Persistence: separate Redis namespace, 7-day TTL.** e.g. `upload_token:<token>` → `{ matter_id, client_email, client_name, created_at }`. Independent of the 1hr chat session key. — Keeps chat data ephemeral, upload tokens durable.
- **Reusability: multi-use until expiry.** Client can return multiple times within 7 days to add more files. Each successful upload fires the Zap and notifies the firm. — Real clients upload in waves, not all at once.
- **Link timing: sent to everyone with the Stripe receipt.** Not gated on the "I'll do it later" branch — also acts as a safety net if in-chat upload fails or a file is forgotten. — Uniform UX, no branching logic.

## Conversation & System Flow (additions to Phase 1)

1. `initiatePayment` succeeds → Stripe webhook fires.
2. Webhook handler (already exists) now **also** generates an upload token, writes `upload_token:<token>` to Redis (7-day TTL) with `{ matter_id, email, name }`, and includes the tokenized URL in the Resend receipt email.
3. New route: `/upload/[token]` — renders a minimal upload UI (drag-drop, same file rules as in-chat: PDF/JPG/PNG/DOCX, 10MB max).
4. New API route: `POST /api/late-upload/[token]` — validates token, streams files to storage (Vercel Blob or similar), calls the "attach to matter" Zap, sends firm notification email.
5. Token is **not** consumed on use — stays valid until TTL expires.
6. Upload page shows a success state after each file and allows adding more.

## Open Questions

- **File storage between upload and Zapier:** Vercel Blob vs direct streaming to Zapier webhook? Probably Blob for retries/reliability — defer to plan phase.
- **Matter ID availability:** Phase 1 submits to Smokeball via Zapier at the end of chat. Need to confirm Zapier can return the created matter ID back to our webhook, or whether we store our own internal matter reference and pass it to the attach Zap instead.
- **"Attach to matter" Zap:** Does the firm's Smokeball Zapier integration support file attachment to an existing matter, or only matter creation? Needs confirmation with the firm during Smokeball Zapier workflow session.
- **Abuse protection:** Rate limit uploads per token? Probably yes — defer to plan phase.
- **Notification cadence:** One email per upload event, or debounced digest? Start with per-event, revisit if noisy.

## Next Steps

→ `/workflows:plan` — design the Redis schema, new routes, Stripe webhook changes, storage choice, and Zapier contract for the attach flow.
