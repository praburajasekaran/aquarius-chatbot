# External Integrations

**Analysis Date:** 2026-04-23

## APIs & External Services

**LLM & AI:**
- Google Gemini 2.5 Flash - Legal advice chatbot backbone
  - SDK/Client: `@openrouter/ai-sdk-provider` + Vercel AI SDK
  - Provider: OpenRouter (cloud LLM platform)
  - Auth: `OPENROUTER_API_KEY` (required)
  - Location: `src/lib/openrouter.ts` - Creates geminiFlash model instance
  - Usage: Chat endpoint at `src/app/api/chat/route.ts` calls geminiFlash with tools

**Payment Processing:**
- BPoint (Commonwealth Bank) - Primary payment processor
  - No SDK; integration via Zapier
  - Auth: `BPOINT_API_USERNAME`, `BPOINT_API_PASSWORD`, `BPOINT_MERCHANT_NUMBER`, `BPOINT_BILLER_CODE`
  - Env: `BPOINT_ENV` (sandbox or prod; facility is prod-only)
  - Smoke test: $0.01 transaction + refund before launch
  - Transaction settlement: Integrates via Zapier workflow (see Zapier section below)

**CRM & Matter Management:**
- Smokeball (via Zapier)
  - No direct SDK; integrated through Zapier automation
  - Data flow: Intake → Zapier → Smokeball Create Matter → Webhook capture-back
  - Capture-back endpoint: `POST /api/webhooks/smokeball-matter-created` with HMAC secret
  - Capture secret: `SMOKEBALL_CAPTURE_SECRET` (generated with `openssl rand -base64 32`)
  - Session-to-matter mapping stored in Redis with 90d TTL (via `src/lib/session-matter-map.ts`)
  - Late document uploads attach to existing matter via Zap #2

**Email & Notifications:**
- Resend
  - SDK: `resend` v6.10.0
  - Auth: `RESEND_API_KEY` (required)
  - Sender domain: `RESEND_FROM_EMAIL` (verified domain required, e.g., chatbot@send.growthkiwi.com)
  - Email templates: React Email in `src/lib/email/` (payment-receipt.tsx, etc.)
  - Endpoints: No public API calls; library used server-side only
  - Sending functions in `src/lib/resend.ts`:
    - `sendTranscriptEmail()` - Firm notification on payment
    - `sendClientInquiryEmail()` - Client confirmation + payment/booking links
    - `sendBookingNotificationEmail()` - Firm notification on Calendly booking
  - No tracking pixels (assert via `src/lib/email/assert-no-tracking.ts`)

- ClickSend (urgent SMS)
  - No SDK in codebase yet; integration planned
  - Auth: `CLICKSEND_USERNAME`, `CLICKSEND_API_KEY`
  - Sender ID: `CLICKSEND_SENDER_ID` (optional; approved alpha IDs need 1-2 business days)
  - Recipient: `URGENT_SMS_RECIPIENT` (E.164 format, e.g., +614...)
  - Purpose: Escalate urgent-matter inquiries via SMS to solicitor during business hours
  - Status: Not yet integrated in code (env vars only)

- Calendly
  - SDK: `react-calendly` v4.4.0 (for embed)
  - Auth: `CALENDLY_PERSONAL_ACCESS_TOKEN` (required for webhook setup)
  - Webhook signing key: `CALENDLY_WEBHOOK_SIGNING_KEY` (HMAC-SHA256; must be generated locally, not echoed by Calendly)
  - Public URLs: `NEXT_PUBLIC_CALENDLY_URL`, `NEXT_PUBLIC_CALENDLY_BOOKING_URL`, `CALENDLY_BOOKING_URL`
  - Webhook endpoint: `POST /api/webhooks/calendly` (signature verification in `src/app/api/webhooks/calendly/route.ts`)
  - Listens for: `invitee.created` event; sends firm booking notification via Resend
  - Component: `src/components/booking/calendly-embed.tsx`

**Document Workflow Automation:**
- Zapier (three production Zaps + one dev-only)
  - No SDK; integration via webhook POST to Zapier URLs
  - Webhook function: `sendToZapier()` in `src/lib/zapier.ts` with 5s timeout and single retry
  - Safety: All prod Zaps have filter "isTest is false OR does not exist" to block accidental test payloads
  - Zap #1 (PROD) - Intake + Payment to Smokeball
    - Triggers: Client completes intake, payment confirmed
    - URL: `ZAPIER_WEBHOOK_URL` (required for production)
    - Flow: Create Matter in Smokeball → tail webhook back to `/api/webhooks/smokeball-matter-created`
  - Zap #2 (PROD) - Late Document Upload to Smokeball
    - URL: `ZAPIER_ATTACH_WEBHOOK_URL` (required for production)
    - Flow: Document uploaded → attach to Smokeball matter via file upload API
  - Zap #3 (PROD) - Durable Audit Log
    - URL: `ZAPIER_AUDIT_WEBHOOK_URL` (required for production)
    - Flow: Append to Google Sheet or email audit record
  - Zap #4 (DEV-ONLY)
    - URL: `ZAPIER_DEV_WEBHOOK_URL` (dev machines only)
    - Flow: Email prabu@motionify.co with payload; never touches Smokeball
    - Safety: Dev machines point `ZAPIER_WEBHOOK_URL` to this URL
  - All Zaps configured to include `isTest` flag to bypass prod Zaps during testing

## Data Storage

**Session Store:**
- Upstash Redis (cloud Redis)
  - URL: `UPSTASH_REDIS_REST_URL` (required)
  - Token: `UPSTASH_REDIS_REST_TOKEN` (required)
  - Client: `@upstash/redis` v1.37.0
  - Storage:
    - Chat sessions: `session:${sessionId}` with 1hr TTL
    - Intake records: `intake:${sessionId}` with 7d TTL
    - Session-matter mapping: `session-matter:${sessionId}` with 90d TTL
    - BPoint payment dedup: `bpoint-txn:${TxnNumber}` with 7d TTL (shared by confirm route + webhook; prevents double fan-out)
  - Rate limit storage (same Redis instance):
    - Token creation limiter: `upload-rl:token` (20 per hour)
    - Global upload limiter: `upload-rl:global` (500 per hour)
    - GET limiter: `upload-rl:get` (120 per hour)

**File Storage:**
- Vercel Blob
  - Token: `BLOB_READ_WRITE_TOKEN` (required for uploads)
  - Storage pattern: `uploads/${sessionId}/${timestamp}-${filename}`
  - Access: Public URLs (no auth required for downloads)
  - File types allowed: PDF, JPG, PNG, DOCX (validated in `src/lib/validators.ts`)
  - Size limit: 10MB per file
  - Max files: 5 per session
  - Used in: `src/app/api/upload/route.ts` (via `@vercel/blob` put function)

## Authentication & Identity

**Auth Provider:**
- Custom (no third-party auth provider; session-based)
  - Implementation: UUIDs as session identifiers (no user login required)
  - Session flow: Client generates UUID → server stores in Redis → includes in requests
  - No traditional user authentication; ephemeral sessions only

**Branding & Config:**
- Firm details (optional, defaults to "Demo Law Firm"):
  - `NEXT_PUBLIC_FIRM_NAME` - Displayed to client
  - `NEXT_PUBLIC_FIRM_TAGLINE` - Displayed to client
  - `FIRM_EMAIL_SENDER_NAME` - Email sender name
  - `NEXT_PUBLIC_PRIVACY_URL` - Privacy policy link
  - Loaded via `src/lib/branding.ts`

## Monitoring & Observability

**Error Tracking:**
- None detected (console.error/console.log only)

**Logs:**
- Console logging throughout codebase
  - Prefixed with service name (e.g., "[bpoint-webhook]", "[bpoint-confirm]", "[upload]", "[smokeball-capture]")
  - Error details logged at webhook endpoints for debugging
  - No external log aggregation service

**Analytics:**
- Upstash rate-limit analytics: `analytics: true` enabled on all Ratelimit instances

## CI/CD & Deployment

**Hosting:**
- Vercel (primary deployment platform)
- Environment variables configured per deployment (Production/Preview/Development)
- Turbopack bundler enabled in `next.config.ts`

**CI Pipeline:**
- None detected (ESLint available but no CI config found)

**Cron Jobs:**
- Vercel Cron (platform-native)
  - Endpoint: `GET /api/cron/upload-cleanup`
  - Auth: Bearer token in `Authorization` header (`CRON_SECRET`)
  - Purpose: Clean up expired upload tokens
  - Schedule: Defined in Vercel dashboard (not in code)

## Environment Configuration

**Required env vars:**
- `OPENROUTER_API_KEY` - Gemini 2.5 Flash LLM
- `BPOINT_API_USERNAME`, `BPOINT_API_PASSWORD`, `BPOINT_MERCHANT_NUMBER` - BPoint payment processing
- `BPOINT_ENV` - BPoint environment flag ("prod" for live; anything else sets IsTestTxn=true)
- `UPSTASH_REDIS_REST_URL` - Session store, rate limiting
- `UPSTASH_REDIS_REST_TOKEN` - Session store auth
- `ZAPIER_WEBHOOK_URL` - Primary intake→Smokeball automation
- `ZAPIER_ATTACH_WEBHOOK_URL` - Document upload→Smokeball
- `ZAPIER_AUDIT_WEBHOOK_URL` - Audit logging
- `SMOKEBALL_CAPTURE_SECRET` - Webhook verification for capture-back
- `RESEND_API_KEY` - Transactional email
- `RESEND_FROM_EMAIL` - Email sender address (verified domain)
- `FIRM_NOTIFY_EMAIL` - Where firm receives notifications
- `CALENDLY_PERSONAL_ACCESS_TOKEN` - Calendly API access
- `CALENDLY_WEBHOOK_SIGNING_KEY` - Webhook verification
- `BLOB_READ_WRITE_TOKEN` - Vercel Blob file storage
- `NEXT_PUBLIC_URL` - Public app URL (shipped to client)
- `APP_URL` - Server-only base URL for magic links
- `UPLOAD_COOKIE_SECRET` - Late-upload session signing (32 bytes, generate with `openssl rand -base64 32`)
- `CRON_SECRET` - Vercel Cron authorization

**Optional env vars:**
- `BPOINT_BILLER_CODE` - BPoint biller code (only required for BPAY flows; optional for card-only)
- `ZAPIER_DEV_WEBHOOK_URL` - Dev-only safe Zap (emails, doesn't touch Smokeball)
- `CLICKSEND_USERNAME`, `CLICKSEND_API_KEY`, `CLICKSEND_SENDER_ID` - SMS notifications (not yet integrated)
- `URGENT_SMS_RECIPIENT` - Who receives urgent SMS (E.164 format)
- `NEXT_PUBLIC_CALENDLY_URL`, `NEXT_PUBLIC_CALENDLY_BOOKING_URL`, `CALENDLY_BOOKING_URL` - Calendly URLs
- `NEXT_PUBLIC_FIRM_NAME`, `NEXT_PUBLIC_FIRM_TAGLINE`, `NEXT_PUBLIC_PRIVACY_URL` - Branding overrides
- `FIRM_EMAIL_SENDER_NAME` - Branding for emails
- `FIRM_NOTIFICATION_EMAIL` - Legacy; use `FIRM_NOTIFY_EMAIL`

**Secrets location:**
- `.env.local` (development; git-ignored)
- Vercel environment variables dashboard (production/preview/development per environment)

## Webhooks & Callbacks

**Incoming Webhooks (Received by App):**
1. BPoint server-to-server payment callback - `POST /api/webhooks/bpoint`
   - Verified via: server-side `retrieveTransaction(ResultKey)` call (callback body NOT trusted; BPoint v2 callbacks are unsigned)
   - Trigger: Transaction completion; safety net for missed browser redirect
   - Payload: `ResultKey` from URL query string — body intentionally ignored

2. Calendly invitee created - `POST /api/webhooks/calendly`
   - Verified via: HMAC-SHA256 signature in `calendly-webhook-signature` header
   - Event type: `invitee.created`
   - Payload: Client name, email, booking time, Calendly event/invitee URIs
   - Trigger: Sends firm booking notification via Resend

3. Smokeball matter created (capture-back from Zapier) - `POST /api/webhooks/smokeball-matter-created`
   - Verified via: `X-Smokeball-Capture-Secret` header (timing-safe comparison)
   - Payload: `{ sessionId, smokeballMatterId }`
   - Trigger: Stores session-to-matter mapping in Redis (90d TTL) for late uploads

**Outgoing Webhooks (App Sends to External Services):**
1. Zapier (three production Zaps + dev-only)
   - URL: `ZAPIER_WEBHOOK_URL` (and `ZAPIER_ATTACH_WEBHOOK_URL`, `ZAPIER_AUDIT_WEBHOOK_URL`)
   - Method: POST with JSON body
   - Timeout: 5s per attempt; single retry on failure
   - Payload varies by Zap (e.g., intake data, document metadata, audit records)
   - Called from: Chat tool execution, upload completion, audit logging

---

*Integration audit: 2026-04-23*
