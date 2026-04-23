# Codebase Concerns

**Analysis Date:** 2026-04-23

## Tech Debt

**Duplicate Redis client initialization:**
- Issue: `src/lib/intake.ts` creates a separate Redis instance instead of reusing the singleton from `src/lib/kv.ts`
- Files: `src/lib/intake.ts` (lines 3-6), `src/lib/kv.ts` (lines 4-7)
- Impact: Multiple Redis connections waste resources; inconsistent connection state management; harder to add logging/metrics
- Fix approach: Import and reuse `redis` from `@/lib/kv` in intake.ts instead of instantiating separately

**Hardcoded fallback email in transactional emails:**
- Issue: Default notification email hardcoded to personal email address
- Files: `src/lib/resend.ts` (line 26)
- Impact: If `FIRM_NOTIFICATION_EMAIL` is missing, firm notifications go to personal email instead of failing visibly; difficult to spot misconfiguration in production
- Fix approach: Throw error if `FIRM_NOTIFICATION_EMAIL` is not set; add validation in startup checks

**Missing error handling for email send failures:**
- Issue: `selectUrgency` tool catches but silently logs email failures (lines 47-58 in `src/lib/tools/select-urgency.ts`)
- Files: `src/lib/tools/select-urgency.ts`, `src/app/api/webhooks/stripe/route.ts`
- Impact: Client may not receive confirmation email; no visibility into why; user thinks submission succeeded
- Fix approach: Decide if email failures should block the flow or be queued for retry; implement dead-letter pattern or alerting

**Session expiration race condition:**
- Issue: Session TTL is 1 hour but user could start intake at 59:50 and complete payment/upload outside the window
- Files: `src/lib/kv.ts` (line 9), `src/lib/intake.ts` (line 8), `src/lib/session-matter-map.ts` (line 18)
- Impact: Session data expires while user is still uploading documents; orphaned payment records; hard to recover
- Fix approach: Extend TTL to 24 hours or implement refresh-on-access pattern; consider longer TTL for paid sessions

**System prompt hardcoded in code:**
- Issue: Large system prompt with firm-specific instructions and behavior rules embedded in TypeScript file
- Files: `src/lib/system-prompt.ts`
- Impact: Changes require code redeploy; prompt is difficult to version or A/B test; hard to audit changes
- Fix approach: Move to external JSON/YAML config or database; allow hot-reload without redeployment

## Known Bugs

**Potential phone validation false negatives:**
- Symptoms: Some valid Australian phone formats rejected during intake
- Files: `src/lib/validators.ts` (lines 4-5)
- Trigger: Phone numbers with non-standard spacing or formats like "+61 2 1234 5678" (space after country code)
- Workaround: Strip spaces manually before entering; use consistent format "0412345678"
- Note: System prompt says "do not reject any of them" (line 46) but regex may be too strict

**Match question scoring ambiguity:**
- Symptoms: Some legitimate questions return no match and trigger fallback
- Files: `src/lib/tools/match-question.ts` (lines 8-41)
- Trigger: Questions with low keyword overlap; complex legal questions; questions combining multiple topics
- Cause: Minimum score threshold of 3 (line 40) may be too high for short queries or rare keywords
- Workaround: Ask follow-up questions to refine the query; rephrase using keywords from knowledge base

## Security Considerations

**Webhook signature verification is timing-safe but incomplete:**
- Risk: Smokeball webhook lacks length validation before signature check
- Files: `src/app/api/webhooks/smokeball-matter-created/route.ts` (lines 48-52)
- Current mitigation: `timingSafeEqualString` prevents timing attacks
- Recommendations: Add max length check on secret header; validate payload schema before processing (already done on line 61); add request ID logging for audit trail

**Calendly webhook signature verification implementation has edge case:**
- Risk: If Calendly changes timestamp format or clock skew exceeds tolerance, verification fails silently
- Files: `src/app/api/webhooks/calendly/route.ts` (lines 25-46)
- Current mitigation: Signature verification uses timing-safe comparison
- Recommendations: Log signature verification failures with timestamp and request headers; implement webhook retry queue; add alerting for repeated failures

**Rate limiting is per-token, not per-IP:**
- Risk: Distributed attack from multiple IPs could bypass rate limit (500/hour global is high)
- Files: `src/lib/rate-limit.ts`, `src/app/api/late-upload/session/route.ts` (lines 27-36)
- Current mitigation: Global limit of 500 requests/hour; per-token limit of 20/hour
- Recommendations: Add IP-based rate limiting; implement CAPTCHA for suspicious patterns; monitor for abuse patterns in analytics

**Upload tokens stored in Redis without rotation:**
- Risk: Long-lived tokens (7 days, line 5 in `src/lib/upload-tokens.ts`) could be compromised via Redis breach or token extraction
- Files: `src/lib/upload-tokens.ts`
- Current mitigation: Tokens are hashed before storage; minimum length enforced (line 34)
- Recommendations: Implement token refresh on each upload; add token revocation endpoint with client notification; monitor for leaked tokens

**Stripe webhook doesn't validate all event fields:**
- Risk: Missing null checks on `session.customer_details` could expose undefined in emails
- Files: `src/app/api/webhooks/stripe/route.ts` (lines 38-41)
- Current mitigation: Null coalescing operators used
- Recommendations: Add strict validation of Stripe event structure; implement Zod schema for event shape; add idempotency checks beyond dedup key

**Branding config loaded from environment without validation:**
- Risk: XSS if NEXT_PUBLIC_* vars contain HTML; email sender name used in emails without escaping
- Files: `src/lib/branding.ts`, `src/lib/resend.ts` (line 28)
- Current mitigation: Values used in HTML context without sanitization
- Recommendations: Validate branding inputs on startup; escape HTML in email templates; use email templates from React Email (already done) but sanitize brand name

## Performance Bottlenecks

**Upload cleanup cron iterates all blobs linearly:**
- Problem: `list()` API with cursor pagination fetches all 1000 blobs per page; no index on uploadedAt
- Files: `src/app/api/cron/upload-cleanup/route.ts` (lines 26-36)
- Cause: Vercel Blob API doesn't support filtering by date range
- Improvement path: Implement local tracking of upload timestamps in Redis; batch deletion more efficiently; monitor for large blob storage buildup

**Knowledge base search is O(n) linear scan:**
- Problem: `findBestMatch()` iterates all QA pairs every query; no indexing
- Files: `src/lib/tools/match-question.ts` (lines 8-41)
- Cause: Knowledge base loaded as JSON array; scoring done in-memory
- Improvement path: Implement trie-based keyword search or Elasticsearch for large KB; cache frequently matched questions; add analytics to identify cold questions

**Session data queried multiple times per request:**
- Problem: `updateSession` calls `getSession()` then writes back; same in checkout/payment flows
- Files: `src/lib/kv.ts` (lines 44-53)
- Cause: Pessimistic read-modify-write pattern; no atomic operations
- Improvement path: Use Redis Lua scripts for atomic updates; implement optimistic locking; batch updates where possible

**Email rendering blocks webhook response:**
- Problem: Stripe webhook waits for email send to complete (line 95 in stripe route)
- Files: `src/app/api/webhooks/stripe/route.ts` (lines 95-105)
- Cause: No async queue; email API calls block webhook response
- Improvement path: Queue emails for async sending; implement retry queue; use SQS or Bull for reliable delivery

## Fragile Areas

**System prompt brittleness:**
- Files: `src/lib/system-prompt.ts`
- Why fragile: 86-line prompt with exact behavior rules; small wording changes could break conversation flow; no unit tests for prompt behavior
- Safe modification: Test prompt changes in staging with full conversation flows; use A/B testing framework; version prompts explicitly
- Test coverage: No automated tests for prompt-level behavior; rely on manual QA

**Match question fallback behavior:**
- Files: `src/lib/tools/match-question.ts`
- Why fragile: Single hardcoded threshold; no learning from missed matches; scoring algorithm tightly coupled to keyword structure
- Safe modification: Implement analytics to track fallback rate; adjust threshold based on data; add logging for near-misses (score 2-2.9)
- Test coverage: No tests for match scoring; knowledge base changes could silently break matching

**Webhook replay and idempotency:**
- Files: `src/app/api/webhooks/stripe/route.ts` (lines 59-69), `src/app/api/webhooks/calendly/route.ts`, `src/app/api/webhooks/smokeball-matter-created/route.ts`
- Why fragile: Stripe dedup uses Redis with 7-day TTL; if Redis clears or webhook is replayed after TTL, duplicate emails sent
- Safe modification: Implement database-backed idempotency keys; use webhook event IDs as primary key; audit webhook deliveries
- Test coverage: No tests for webhook replay scenarios

**Session-matter mapping lookup:**
- Files: `src/lib/session-matter-map.ts`, `src/app/api/late-upload/session/route.ts`
- Why fragile: 90-day TTL could expire mid-upload if user delays; no alerting if mapping missing at late-upload time
- Safe modification: Add explicit error when mapping not found; implement recovery flow; extend TTL for paid sessions
- Test coverage: No tests for TTL expiration scenarios

## Scaling Limits

**Redis connection pool:**
- Current capacity: Single Upstash Redis instance; shared across 5+ different key patterns
- Limit: If traffic exceeds Upstash plan limits, all features fail simultaneously
- Scaling path: Implement connection pooling; move high-frequency lookups to local cache; consider multi-tier caching (local → Redis → DB)

**Vercel Blob storage:**
- Current capacity: No quota enforcement; cleanup runs daily but only retrospectively
- Limit: Large volume of uploads could bloat storage costs
- Scaling path: Implement proactive quota enforcement per session; add cost monitoring alerts; implement tiered storage (archive old uploads)

**Email sending throughput:**
- Current capacity: Resend API called synchronously from webhooks; no queue
- Limit: If email API rate-limited or slow, webhook response times increase
- Scaling path: Implement job queue (Bull, RabbitMQ); batch email sends; add circuit breaker for email API failures

**Knowledge base search:**
- Current capacity: JSON loaded into memory; linear search O(n)
- Limit: If knowledge base grows beyond ~1000 QA pairs, search latency becomes noticeable
- Scaling path: Implement full-text search (Elasticsearch, MeiliSearch); cache hot queries; implement relevance ranking

## Dependencies at Risk

**@openrouter/ai-sdk-provider (custom fork/wrapper):**
- Risk: OpenRouter is not the official Anthropic/OpenAI provider; potential API breaking changes
- Impact: If OpenRouter changes API or discontinues service, LLM calls fail
- Migration plan: Maintain fallback to native `@ai-sdk/openai` provider; test provider switching; monitor OpenRouter status

**Vercel Blob (proprietary):**
- Risk: Vendor lock-in; no self-hosted alternative; pricing/API could change
- Impact: Upload feature depends entirely on Vercel Blob availability
- Migration plan: Implement S3-compatible abstraction layer; keep Blob SDK imports isolated in `src/lib/`; document migration steps to S3

**Upstash Redis (serverless):**
- Risk: Cold starts and latency variations; price increases; service discontinuation
- Impact: All session state, rate limiting, and dedup logic fails if Redis unavailable
- Migration plan: Implement local fallback cache; use Redis Cluster for redundancy; monitor latency metrics

## Missing Critical Features

**No observability/monitoring:**
- Problem: 30 console.error calls scattered throughout; no centralized logging or metrics
- Blocks: Can't easily debug production issues; no visibility into error rates or performance
- Implementation: Add structured logging with context (request ID, session ID); implement metrics collection; add Sentry or similar for error tracking

**No session state machine validation:**
- Problem: Session can transition between states without validation (e.g., "paid" → "pending" possible)
- Blocks: Data integrity issues; hard to detect corruption
- Implementation: Use state machine library; validate transitions; add audit log for state changes

**No webhook reconciliation:**
- Problem: If webhook delivery fails after webhook handler runs, no recovery mechanism
- Blocks: Stuck sessions; missed payments; orphaned data
- Implementation: Implement webhook event log; add manual reconciliation UI; implement replay queue

**No API rate limiting by session:**
- Problem: A malicious session could spam chat endpoint while respecting global limits
- Blocks: Can't prevent conversation spam attacks
- Implementation: Add rate limiting per `sessionId`; implement exponential backoff; add CAPTCHA for blocked users

## Test Coverage Gaps

**Webhook replay and idempotency:**
- What's not tested: Stripe/Calendly webhook replay scenarios; dedup key expiration; concurrent webhook requests
- Files: `src/app/api/webhooks/*`
- Risk: Silent duplicate actions (duplicate emails, double charges); hard to detect in production
- Priority: High - Financial impact

**Rate limiting effectiveness:**
- What's not tested: Distributed attack patterns; token/global limit interaction; rate limit boundary conditions
- Files: `src/lib/rate-limit.ts`, `src/app/api/late-upload/session/route.ts`
- Risk: Rate limiting bypass; resource exhaustion
- Priority: High - Security impact

**Session expiration edge cases:**
- What's not tested: Session TTL expiration during payment flow; concurrent session updates; race conditions
- Files: `src/lib/kv.ts`, `src/lib/intake.ts`
- Risk: Data loss; orphaned payment records
- Priority: High - Data integrity

**Phone/email validation coverage:**
- What's not tested: Edge cases in Australian phone formats; international formats; edge cases in email validation
- Files: `src/lib/validators.ts`
- Risk: Valid inputs rejected; invalid inputs accepted
- Priority: Medium - User experience

**Knowledge base matching accuracy:**
- What's not tested: Match scoring algorithm; threshold sensitivity; coverage of knowledge base
- Files: `src/lib/tools/match-question.ts`
- Risk: Low match accuracy; frequent fallback responses
- Priority: Medium - User experience

**Webhook signature verification:**
- What's not tested: Replay attacks; malformed signatures; timestamp manipulation (Calendly)
- Files: `src/app/api/webhooks/calendly/route.ts`, `src/app/api/webhooks/smokeball-matter-created/route.ts`
- Risk: Unauthorized webhook execution
- Priority: High - Security

---

*Concerns audit: 2026-04-23*
