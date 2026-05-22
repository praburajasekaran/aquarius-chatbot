---
status: partial
phase: 04-re-engagement-framework-payment-abandonment
source: [04-VERIFICATION.md]
started: 2026-05-07T18:48:00Z
updated: 2026-05-07T18:48:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Staging end-to-end — 1h hybrid email
expected: Complete intake → wait 1h → 1h hybrid email arrives. Email shows Aquarius logo, payment-resume link works, LSS explainer block visible, unsubscribe link resolves to /unsubscribed; Redis key `email-reminder-sent:payment-abandonment-1h:{sessionId}` exists with TTL ≈ 7d (ROADMAP §Success Criteria #7).
result: [pending]

### 2. Firm-principal copy sign-off
expected: PAYMENT_1H_SUBJECT, PAYMENT_24H_SUBJECT, PAYMENT_1H_BODY, PAYMENT_24H_BODY, and all 8 LSS_EXPLAINER_BLOCK fields hold approved firm-principal copy in `src/lib/email-reminders/copy.ts`; assertCopyApproved() does NOT throw under NODE_ENV=production. Required for Spam Act / DCEM compliance.
result: [pending]

### 3. End-to-end unsubscribe loop on staging
expected: Click unsubscribe link in delivered reminder → /unsubscribed page renders branded confirmation; Redis key `unsubscribe:{sessionId}` exists with TTL ≈ 30d; both pending payment-abandonment QStash messages are cancelled (verified via QStash dashboard).
result: [pending]

### 4. Webhook signature rejection (INFRA-03 runtime)
expected: POST /api/webhooks/email-reminder without valid x-upstash-signature header returns non-200; verifySignatureAppRouter blocks the inner handler. Real QStash signing keys required (tests use passthrough HOC mock).
result: [pending]

### 5. Triage 04-REVIEW.md critical findings (CR-01, CR-02, CR-03)
expected: Decide whether to fix in this phase or accept as documented warnings before staging deploy. CR-01 (assertCopyApproved after NX claim → silent dedup of retries), CR-02 (getIntake throw leaks NX claim), CR-03 (relative URLs when APP_URL absent breaks unsubscribe) are operational defects in `src/app/api/webhooks/email-reminder/route.ts`.
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
