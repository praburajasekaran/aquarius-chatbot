---
created: 2026-05-03T10:24:14.319Z
title: Switch Vercel Blob to private + signed URLs (audit H4)
area: api
files:
  - src/app/api/upload/route.ts:105
  - src/lib/late-upload/handle-completed.ts:43
  - src/lib/in-chat-upload/deliver-to-zapier.ts
  - src/lib/zapier.ts
---

## Problem

H4 from the main-branch security audit (2026-05-03). Every Vercel Blob upload —
both the in-chat path ([src/app/api/upload/route.ts](src/app/api/upload/route.ts)
line 105) and the late-upload completion path
([src/lib/late-upload/handle-completed.ts](src/lib/late-upload/handle-completed.ts)
line 43) — is stored with `access: "public"`. The URL is unguessable but it
then gets forwarded to:

- Zapier (in-chat → ZAPIER_WEBHOOK_URL, late-upload → ZAPIER_ATTACH_WEBHOOK_URL)
- Smokeball as the file URL on the matter
- ZAPIER_AUDIT_WEBHOOK_URL (durable audit log — often a Google Sheet)
- Firm notification email body (raw URL)
- Client confirmation email ("we received a file")

Any one of those channels can leak the URL and grant permanent read of the
criminal-matter evidence: Zapier execution logs, Smokeball file metadata,
Resend's outbound mail server, a forwarded firm email in Slack/Teams, or an
audit Google Sheet set to "anyone with link". The unguessable URL is the only
gate; once leaked it never expires (until someone manually deletes the blob).

This is the only finding from the original audit that's still outstanding.
PRs 58–63 cover everything else (C1, C2, C3, H1, H2, H3, H5, H6, plus the
medium-priority bundle).

## Solution

Stage A — server side:

- Switch every `put()` call to `access: "private"`. Vercel Blob v2.x supports
  this (confirmed via Context7).
- Build a new authenticated server endpoint that mints short-lived signed
  download URLs for staff on demand. Auth is the open question — likely a
  Resend magic-link to FIRM_NOTIFY_EMAIL, or a session cookie minted by an
  admin login route.
- Or: server-side download proxy that streams the file after authenticating
  the firm staff member (simpler, no signed-URL TTL to manage).

Stage B — Zapier flow rework (the load-bearing constraint):

- The intake/attach Zaps currently consume `file.url` (a permanent public CDN
  URL). They need to switch to consuming `pathname` / `blob_id` and call back
  into our app for a fresh signed URL when uploading to Smokeball.
- The audit Zap (Google Sheet) should record the pathname only, not the URL.
- The firm notification email should link to a staff-authenticated download
  page, not the raw blob URL.
- The client "we received a file" email — clients shouldn't need download
  access at all (they uploaded the file); just remove the URL from that email.

Stage C — migration:

- Existing public blobs need a backfill: list, re-upload as private, update
  any references in Smokeball / audit sheets. Or accept that pre-migration
  files keep their public URLs and only new uploads are private. Lower-risk
  option since old URLs are at least already issued.

Why this is deferred: the Zapier rework is the bulk of the work and needs
firm-side coordination (Smokeball Zap reconfiguration is in their account, not
ours). Not a quick win.

Tracking refs:

- GitHub PRs: #58, #59, #60, #61, #62, #63 (siblings — already shipped /
  ready)
- Audit document: in-conversation security review on 2026-05-03 (no doc
  saved). Re-run `/security-review` and read the H4 section if context is
  needed later.
