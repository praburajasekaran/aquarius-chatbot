# Codebase Concerns

**Analysis Date:** 2026-04-24

## Security Concerns

### Prompt Injection Surface in Chat API

**Issue:** The chat endpoint at `src/app/api/chat/route.ts` accepts user messages directly without sanitization and passes them to the LLM. The system prompt in `src/lib/system-prompt.ts` is comprehensive but relies heavily on LLM instruction-following, which can be circumvented by sophisticated prompt injection attacks.

**Files:** `src/app/api/chat/route.ts`, `src/lib/system-prompt.ts`, `src/lib/tools/match-question.ts`

**Impact:** Attackers could manipulate the LLM to:
- Bypass knowledge base restrictions and provide unlicensed legal advice
- Exfiltrate system prompts or tool descriptions
- Generate misleading guidance on booking, payment, or matter urgency
- Potentially bypass the `matchQuestion` tool's approval gate

**Mitigation Currently in Place:**
- Knowledge base is static JSON, not LLM-generated
- Tools are server-side execution only for sensitive operations
- System prompt emphasizes instruction-following ("ALWAYS call matchQuestion")

**Recommended Fixes:**
- Add input validation/sanitization layer before chat endpoint receives messages
- Implement prompt injection detection (pattern matching for jailbreak attempts)
- Add rate limiting per session to detect abuse patterns
- Consider using structured outputs (OpenAI structured mode) to constrain LLM responses
- Periodically audit system prompt effectiveness by testing known jailbreaks

### Stripe Webhook Secret Handling

**Issue:** The Stripe webhook handler at `src/app/api/webhooks/stripe/route.ts` relies on `process.env.STRIPE_WEBHOOK_SECRET` being correctly set at runtime. No rotation mechanism or validation of secret format.

**Files:** `src/app/api/webhooks/stripe/route.ts` (line 26)

**Impact:** If the webhook secret is compromised or misconfigured, attackers could:
- Forge payment completion events
- Trigger email spam campaigns
- Create upload tokens for arbitrary email addresses
- Exhaust upload quotas

**Mitigation Currently in Place:**
- Proper signature validation using `constructEvent()`
- 400 status returned on invalid signatures
- Environment variable configuration

**Recommended Fixes:**
- Add webhook secret rotation capability (versioned secrets with fallback support)
- Log all webhook validation failures with timestamps (currently logs on error only)
- Consider Stripe's new webhook signing headers and metadata for additional validation
- Implement a webhook event replay detection mechanism to prevent duplicate processing

### Upload Token Exposure via Email

**Issue:** The upload token is embedded directly in the email link in `src/lib/resend.ts` (line 86: `${appUrl}/upload/${rawToken}`). If Resend has click tracking enabled, the token would be leaked to Resend's tracking infrastructure.

**Files:** `src/lib/resend.ts`, `src/lib/email/assert-no-tracking.ts`

**Impact:** Upload tokens (valid for 7 days) could be intercepted by:
- Email service providers with tracking enabled
- Network proxies inspecting HTTP referrers
- Email archival systems

**Mitigation Currently in Place:**
- `assertNoResendTracking()` check runs once per serverless instance to verify tracking is disabled
- Uses SHA256 hashing for token comparison in late-upload handler
- Short 7-day TTL on tokens

**Recommended Fixes:**
- Use redirect-based token delivery instead of direct embedding (e.g., `/api/get-upload-link?session_id=...`)
- Add explicit "no tracking" header in Resend email configuration
- Rotate upload tokens periodically even if unused
- Log all token lookups and document expected access patterns

### Smokeball Webhook Secret Not Using Timing-Safe Comparison Wrapper

**Issue:** The Smokeball capture endpoint at `src/app/api/webhooks/smokeball-matter-created/route.ts` implements timing-safe comparison correctly (using `timingSafeEqualString`), but this is a custom implementation. Other webhook handlers should follow the same pattern.

**Files:** `src/app/api/webhooks/smokeball-matter-created/route.ts` (lines 29-34), `src/app/api/webhooks/calendly/route.ts` (lines 37-45)

**Impact:** Timing attacks are theoretical (not practical over the internet), but patterns should be consistent for maintainability and security posture.

**Mitigation Currently in Place:**
- Both Smokeball and Calendly use timing-safe comparison
- Custom implementation in Smokeball; built-in in Calendly

**Recommended Fixes:**
- Extract timing-safe comparison to a shared utility `src/lib/crypto-utils.ts`
- Ensure all future webhook handlers use the shared utility
- Add JSDoc noting why timing-safe comparison is necessary

### Calendly Session ID Extraction from UTM Parameter

**Issue:** Session ID is extracted from `invitee.tracking?.utm_content` in `src/app/api/webhooks/calendly/route.ts` (line 74). This relies on the Calendly booking link being correctly constructed with the session ID embedded, but there's no validation that the extracted session ID matches the booking context.

**Files:** `src/app/api/webhooks/calendly/route.ts`

**Impact:** An attacker could:
- Send a booking event with a spoofed UTM parameter linking to a different client's session
- Cause intake records to be corrupted
- Potentially associate one client's booking with another's matter

**Mitigation Currently in Place:**
- `getIntake(sessionId)` validates session exists before sending notifications
- Booking notification only uses intake data if session found

**Recommended Fixes:**
- Validate that the Calendly booking's customer email matches the intake record's email before updating
- Add logging for any mismatches with detailed context
- Consider storing booking invitee URI in intake record and validating it on webhook

---

## Architectural Concerns

### Session State Split Across Redis Keys

**Issue:** Session data is stored in multiple Redis namespaces with inconsistent TTLs:
- `session:*` (1 hour TTL) in `src/lib/kv.ts`
- `intake:*` (7 days TTL) in `src/lib/intake.ts`
- `upload-token:*` (7 days TTL) in `src/lib/upload-tokens.ts`
- `stripe-session:*` (7 days TTL, hash-based dedup) in `src/app/api/webhooks/stripe/route.ts`

**Files:** `src/lib/kv.ts`, `src/lib/intake.ts`, `src/lib/upload-tokens.ts`, `src/app/api/webhooks/stripe/route.ts`

**Impact:**
- Inconsistent TTLs mean sessions are deleted while intake records are still valid
- Complex data flow: `stripe-session:*` is used to link upload token hash to session ID
- Difficult to audit what data exists for a given session after cleanup
- Risk of orphaned records (intake without session, upload tokens without corresponding session)

**Recommended Fixes:**
- Create a unified `SessionContext` type containing session + intake + upload token data
- Consolidate under a single Redis key with consistent TTL management
- Implement a session cleanup cron that deletes all related data atomically
- Add session introspection endpoint for debugging

### Unvalidated Matter Linkage

**Issue:** Smokeball matter ID is captured in `src/app/api/webhooks/smokeball-matter-created/route.ts` and stored in Redis with a 90-day TTL. If the session expires (1 hour), the matter mapping persists separately, creating potential for confusion.

**Files:** `src/lib/session-matter-map.ts`, `src/app/api/webhooks/smokeball-matter-created/route.ts`

**Impact:**
- A new session could be created with the same session ID after expiry, reusing the old matter mapping
- Files from different conversations could be attached to the same Smokeball matter
- Audit trail becomes unreliable

**Recommended Fixes:**
- Use compound keys: `matter-mapping:{sessionId}:{createdAt}`
- Validate matter ID existence in Smokeball before storing (requires Smokeball API call)
- Store matter-session mapping in intake record instead of separate Redis key
- Add strong TTL alignment: matter mapping should match or precede session/intake expiry

### Email Sending Failures Not Affecting Payment Confirmation

**Issue:** In `src/app/api/webhooks/stripe/route.ts`, email sending failures (lines 118-124) are caught and logged but don't prevent the webhook from returning HTTP 200. This is intentional (stripe retries on 4xx/5xx), but means payment is confirmed even if client notification fails.

**Files:** `src/app/api/webhooks/stripe/route.ts`

**Impact:**
- Client may not receive payment confirmation or upload link
- Firm is notified but client is in dark about next steps
- Stored in firm's inbox as incomplete without re-notification

**Mitigation Currently in Place:**
- Returns HTTP 200 so Stripe doesn't retry forever
- Logs errors with session and Stripe session ID for manual follow-up

**Recommended Fixes:**
- Implement a dead-letter queue for failed email sends
- Add a separate cron job that processes failed sends and retries
- Send a degraded confirmation email (plaintext fallback) on React component failure
- Track email send status in intake record for support dashboard

### Rate Limiting on Late Upload Lacks Granularity

**Issue:** `src/lib/rate-limit.ts` defines three limiters but the late-upload endpoint `src/app/api/late-upload/session/route.ts` combines them:
- Per-token: 20 requests per hour
- Global: 500 requests per hour
- Per-session GET: 120 requests per hour (defined but not used)

**Files:** `src/lib/rate-limit.ts`, `src/app/api/late-upload/session/route.ts`

**Impact:**
- A single attacker with a valid token could legitimately upload 20 files per hour, potentially filling storage
- Global limit of 500 is high; one coordinated attack across 25 valid tokens saturates it
- GET limiter defined but never applied, suggesting incomplete implementation

**Mitigation Currently in Place:**
- Soft limits (429 response, analytics tracking)
- File size validation (10MB max per file)
- File count validation (5 files per session max)

**Recommended Fixes:**
- Reduce per-token limit to 5 requests per hour (one upload per ~12 minutes)
- Add per-IP rate limiting as secondary layer
- Implement total upload size per session limit (e.g., 50MB total across all files)
- Apply the unused GET limiter to token resolution requests
- Add adaptive rate limiting that tightens if abuse detected

---

## Data Integrity Concerns

### Magic Byte Validation Insufficient for File Type Spoofing

**Issue:** `src/lib/late-upload/handle-completed.ts` validates file MIME type via magic bytes (lines 40-68), but only checks the first 4096 bytes. A polyglot file (valid PDF + malicious script) could pass validation.

**Files:** `src/lib/late-upload/handle-completed.ts`

**Impact:**
- Attackers could upload files that appear as PDFs but contain malicious content
- Firm staff viewing in Smokeball could execute embedded scripts
- Supply chain attack vector if files are processed downstream

**Mitigation Currently in Place:**
- Allowed MIME types are restricted: PDF, JPG, PNG, DOCX
- Content-type is re-validated on upload (declared type + magic byte detection must agree)
- Files deleted if validation fails

**Recommended Fixes:**
- Use a dedicated library like `file-type` with extended validation (already used, good)
- Scan files with antivirus API (ClamAV, VirusTotal) before storing
- Convert PDFs to images server-side before delivery (reduces script execution risk)
- Log all validation failures and build a blocklist of suspicious file hashes
- Consider quarantine period: store files in separate "unvalidated" bucket before moving to main

### Session ID Generation Not Cryptographically Unique

**Issue:** Session IDs are generated client-side (no details in provided code, likely `crypto.randomUUID()`), but collision handling is implicit. If two users generate the same session ID, they'll share session data.

**Files:** Not found in provided code (likely in frontend), but affects `src/lib/kv.ts`

**Impact:**
- Two clients could accidentally share session/intake data
- Unlikely but possible with poor PRNG
- No server-side validation of uniqueness

**Mitigation Currently in Place:**
- `createSession()` creates on-demand if missing
- UUID v4 is cryptographically strong (assuming that's what frontend uses)

**Recommended Fixes:**
- Server should validate session ID format (e.g., UUID v4 format only)
- Add server-side collision detection: if session already exists, reject with error
- Log collision attempts (potential attack signal)
- Communicate to frontend: only accept RFC 4122 UUID v4 format

---

## Performance Concerns

### Knowledge Base Search Algorithm O(n) Without Caching

**Issue:** `src/lib/tools/match-question.ts` iterates through all Q&A pairs and scores each one (lines 15-36). With 50+ Q&As, this is O(n) per query. No caching of scoring results.

**Files:** `src/lib/tools/match-question.ts`

**Impact:**
- Every user query triggers full table scan
- At scale (thousands of concurrent users), Redis gets hammered
- High LLM latency waiting for tool response

**Mitigation Currently in Place:**
- Minimum score threshold prevents all-match fallback
- Small knowledge base (~50 Q&As) limits impact

**Recommended Fixes:**
- Build search index: create keyword->question-id map at startup
- Cache scoring results per unique query in Redis (1-hour TTL)
- Use Upstash Vector to store embeddings of questions and do similarity search
- Implement LRU cache of recent query scores in memory (per serverless instance)

### Webhook Retry Storm Risk on transient failures

**Issue:** If Resend, Redis, or Zapier is temporarily down during webhook processing (e.g., `src/app/api/webhooks/stripe/route.ts`), the error is logged but the webhook still returns 200. If the same failure happens in the retry queue, it won't retry automatically.

**Files:** `src/app/api/webhooks/stripe/route.ts`, `src/app/api/webhooks/calendly/route.ts`, `src/lib/late-upload/handle-completed.ts`

**Impact:**
- Transient failures become permanent data loss (no audit trail of what was skipped)
- Customers don't receive notifications
- Firm doesn't receive inquiries
- Unrecoverable without manual intervention

**Mitigation Currently in Place:**
- All errors logged with context
- Returns 200 so Stripe doesn't retry (correct behavior)

**Recommended Fixes:**
- Implement a persistent job queue (Bull/BullMQ via Redis) for email sends
- Separate webhook handler into: validate + queue, then process async
- Return 202 Accepted instead of 200, process emails in background
- Add exponential backoff to job queue (retry up to 5 times over 24 hours)
- Store failed job payloads in Redis for manual replay

### Large List Iteration in Blob Cleanup

**Issue:** `src/app/api/cron/upload-cleanup/route.ts` fetches all blobs (potentially thousands) and filters in memory. If the blob list grows large, this becomes slow and memory-intensive.

**Files:** `src/app/api/cron/upload-cleanup/route.ts`

**Impact:**
- Cron job timeout if blob storage gets large
- Memory exhaustion on Vercel (30s function timeout)
- Cleanup not running = storage bloat and cost overruns

**Mitigation Currently in Place:**
- Pagination via cursor (line 27)
- Batch deletion (up to 1000 per iteration)

**Recommended Fixes:**
- Reduce batch size if timeout occurs (currently 1000)
- Add Prometheus metrics for execution time and blobs deleted
- Consider Vercel Blob lifecycle policies if available (automatic cleanup)
- Split cleanup into multiple cron jobs (one per date range)

---

## Testing & Observability Gaps

### No Test Coverage for Core Flows

**Issue:** No test files found in codebase. Critical paths like payment confirmation, Stripe webhook validation, and token generation have no automated tests.

**Files:** No `*.test.ts`, `*.spec.ts` files found

**Impact:**
- Regressions undetected until production
- Webhook logic changes risk breaking payment flow
- Security validations (signature verification) could be silently broken

**Recommended Fixes:**
- Add `src/lib/__tests__/stripe.test.ts` for webhook signature validation
- Add `src/lib/__tests__/upload-tokens.test.ts` for token lifecycle
- Add `src/app/api/__tests__/webhooks.test.ts` for all webhook endpoints
- Configure Jest or Vitest with 80%+ coverage threshold
- Add integration tests for end-to-end flows (intake → payment → upload)

### Insufficient Logging for Audit Trail

**Issue:** Logging is present but inconsistent:
- Some endpoints log on error only (e.g., `src/app/api/chat/route.ts` doesn't log at all)
- Email send failures logged but not searchable (single console.error)
- No structured logging (JSON format) making log aggregation difficult

**Files:** Multiple (see console.error/warn count: 32 total)

**Impact:**
- Difficult to debug customer complaints
- Audit trail for compliance unclear
- SLA tracking impossible

**Recommended Fixes:**
- Use structured logging library (Pino, Winston) with JSON output
- Log ALL webhook invocations with timestamp, payload hash, response status
- Add request ID to all logs (propagate through async calls)
- Implement log retention policy (7 days min for webhooks, 90 days for payments)
- Add Datadog/CloudWatch integration for metrics and alerting

### No Monitoring for Stripe Webhook Lag

**Issue:** Stripe webhook handler processes immediately inline. No tracking of event age or processing latency.

**Files:** `src/app/api/webhooks/stripe/route.ts`

**Impact:**
- Unknown if webhooks are arriving on time
- Payment processing delays undetected
- Customer support can't correlate timing issues

**Recommended Fixes:**
- Log webhook event timestamp and processing time
- Alert if event age > 5 minutes (indicates delivery lag)
- Track webhook processing latency P50/P95/P99
- Monitor deduplication hit rate (how often is `created !== "OK"`?)

---

## Fragile Areas

### Conditional Email Logic in Payment Flow

**Issue:** `src/app/api/webhooks/stripe/route.ts` sends different emails based on whether `sessionId` and `clientEmail` exist (lines 43-125). Complex nesting with multiple try-catch blocks.

**Files:** `src/app/api/webhooks/stripe/route.ts`

**Impact:**
- Easy to break with small changes
- Logic flow hard to follow
- Test coverage would be needed to prevent bugs

**Safe Modification:**
- Extract email logic to separate function
- Validate all preconditions before attempting sends
- Make each email send independent (one failure doesn't cascade)

### Signup/Session State Machine Unclear

**Issue:** Multiple tools orchestrate state transitions (collectDetails → selectUrgency → initiatePayment → uploadDocuments), but there's no state machine definition or validation that prevents out-of-order calls.

**Files:** `src/lib/system-prompt.ts` (encodes flow in prose), multiple tool files

**Impact:**
- LLM could call tools out of order (bypassed by instruction-following, but fragile)
- State corruption if API called directly
- Hard to debug if state is inconsistent

**Recommended Fixes:**
- Define explicit state machine in `src/lib/session-state.ts`
- Validate state transitions before executing each tool
- Return error if tool called in invalid state
- Add state assertion checks in production logs

---

## Known Workarounds & Technical Debt

### Resend Tracking Check Cached at Module Scope

**Issue:** `src/lib/email/assert-no-tracking.ts` caches the Resend domain check (lines 5-18) in a module-level Promise. This prevents re-checking if tracking is accidentally enabled mid-deployment.

**Files:** `src/lib/email/assert-no-tracking.ts`

**Impact:**
- If Resend tracking is enabled after first serverless instance boot, tokens are leaked
- Silent failure (token leak not detected)
- Requires instance restart to re-check

**Recommended Fixes:**
- Move cache to Redis with hourly TTL
- Check tracking on every payment webhook (small overhead for critical security)
- Add alerting if check fails

### Manual Reconciliation for Missing Smokeball Matter IDs

**Issue:** `src/lib/late-upload/handle-completed.ts` (lines 146-152) flags uploads with missing Smokeball matter IDs and sends manual reconciliation email. This is a workaround, not a solution.

**Files:** `src/lib/late-upload/handle-completed.ts`, `src/app/api/webhooks/smokeball-matter-created/route.ts`

**Impact:**
- Firm must manually reconcile files after upload
- Risk of files lost or attached to wrong matter
- Scalability issue: won't work if upload volume increases

**Recommended Fixes:**
- Implement Smokeball API polling to verify matter creation before enabling uploads
- Block upload UI if matter not yet captured from Smokeball webhook
- Add retry logic: if matter not found, queue upload for 5-minute delay and retry

---

## Missing Features (Not Bugs, But Gaps)

### No GDPR Compliance for Data Deletion

**Issue:** Once session expires, data is automatically deleted from Redis, but:
- Intake records stored 7 days (GDPR requires "reasonable retention")
- No explicit "right to be forgotten" implementation
- Upload tokens not revoked on session expiry

**Files:** `src/lib/kv.ts`, `src/lib/intake.ts`, `src/lib/upload-tokens.ts`

**Impact:**
- Non-compliant with GDPR/privacy regulations
- No way for user to demand data deletion
- Audit trail doesn't track who accessed data

**Recommended Fixes:**
- Add `DELETE /api/session/:sessionId` endpoint requiring proof of identity
- Implement cascading deletion: session → intake → upload tokens → blobs
- Log all deletions for audit trail
- Add privacy policy with retention periods
- Implement anonymization option (keeping intake for statistics but removing PII)

### No Circuit Breaker for Zapier Calls

**Issue:** `src/lib/late-upload/handle-completed.ts` calls two Zapier webhooks sequentially with no fallback if Zapier is down.

**Files:** `src/lib/late-upload/handle-completed.ts`

**Impact:**
- Upload processing slows if Zapier is slow (no timeout)
- No fallback if Zapier permanently down
- Firm has no visibility of upload if Zap fails

**Recommended Fixes:**
- Add timeout (5-second max) to Zapier calls
- Implement exponential backoff and queue failed Zaps in Redis
- Return graceful error to client if Zap fails (still accept upload, notify firm separately)
- Monitor Zapier health and disable integration if unhealthy

---

## Dependencies at Risk

### @ai-sdk/openai Pinned to v3.0.52

**Issue:** `package.json` pins `@ai-sdk/openai` to `^3.0.52`. This version may have security issues or bug fixes in newer releases.

**Files:** `package.json`

**Impact:**
- Security vulnerabilities in pinned version could affect chat API
- Incompatibility with newer Vercel AI SDK if other packages upgrade

**Recommended Fixes:**
- Upgrade to latest `3.x` version regularly (test thoroughly first)
- Set up Dependabot to alert on security updates
- Review changelog before upgrading

### @upstash/redis v1.37.0 May Be Outdated

**Issue:** `@upstash/redis` at v1.37.0. Check if there are major version bumps with breaking changes.

**Files:** `package.json`

**Impact:**
- Potential API incompatibilities
- Performance improvements in newer versions

**Recommended Fixes:**
- Check Upstash changelog for v2.0.0 if available
- Plan migration with full test coverage

---

## Summary of Priorities

**Critical (Security/Compliance):**
1. Implement prompt injection detection in chat endpoint
2. Add Stripe webhook secret rotation capability
3. Validate Calendly session ID against intake email
4. Add GDPR right-to-be-forgotten endpoint

**High (Data Integrity/Availability):**
1. Consolidate Redis session state under single key
2. Implement job queue for email sends (prevent loss on failure)
3. Add file type scanning with antivirus
4. Implement session state machine validation

**Medium (Observability/Performance):**
1. Add structured JSON logging
2. Implement knowledge base search caching/indexing
3. Add rate limiting per IP address
4. Monitor webhook latency and add alerting

**Low (Technical Debt):**
1. Extract timing-safe comparison utility
2. Add comprehensive test suite
3. Move Resend tracking check to Redis cache
4. Add circuit breaker for Zapier

---

*Concerns audit: 2026-04-24*
