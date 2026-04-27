# Testing Patterns

**Analysis Date:** 2026-04-24

## Test Framework

**Status:** No automated testing framework configured

**Current State:**
- No test runner installed (Jest, Vitest, Mocha, etc.)
- No test files exist in the codebase (`*.test.ts`, `*.spec.ts`)
- No test scripts in `package.json`
- No test configuration files (`jest.config.js`, `vitest.config.ts`, etc.)

**Implication:**
Testing is currently manual. All changes require manual verification or end-to-end validation through the running application.

## Testing Strategy (Manual)

Given the absence of automated tests, the codebase relies on:

**1. Type Safety via TypeScript:**
- Strict mode enabled in `tsconfig.json`
- Type annotations on all functions and components prevent entire classes of bugs
- Example: `urgency: "urgent" | "non-urgent"` in `src/lib/stripe.ts` prevents invalid urgency values at compile time

**2. Linting via ESLint:**
- `npm run lint` catches common mistakes
- ESLint config: `eslint.config.mjs` (flat config)
- Catches unused variables, missing dependencies, undefined values

**3. AI SDK Tool Validation:**
- Tools use Zod for input schema validation — `src/lib/tools/collect-details.ts` validates email, phone, name format
- Each tool's `execute` function validates and returns structured error responses
- Example from `src/lib/tools/collect-details.ts`:
  ```typescript
  const errors: string[] = [];
  if (!name.trim() || name.trim().length < 2) {
    errors.push("Please provide your full name.");
  }
  // ... more validation
  return { valid: false, errors };
  ```

**4. Runtime Validation:**
- Validators in `src/lib/validators.ts` check email, Australian phone format, file type, file size
- Sensitive operations (Stripe, Zapier, email) include error handling and logging for debugging

## Test File Organization

**Not applicable** — no test files in codebase

**If tests were to be added:**
- **Location:** Co-located with source files — `src/lib/validators.test.ts` alongside `src/lib/validators.ts`
- **Naming:** `[module].test.ts` (preferred) or `[module].spec.ts`
- **Recommended runner:** Vitest (lightweight, Next.js compatible) or Jest (if full Node.js testing needed)

## Manual Test Coverage Areas

**1. User Input Validation:**
- Component props are type-checked
- Form inputs validate via Zod schemas in tools
- Example pathway: User enters email → `collectDetails` tool validates via Zod → returns `{ valid: false; errors }` → UI displays errors

**2. External Service Integration:**
- Stripe checkout creation (`src/app/api/checkout/route.ts`) — test by initiating payment flow
- Zapier webhooks (`src/lib/zapier.ts`) — test by uploading documents or updating matter status
- Resend email sending (`src/lib/resend.ts`) — test by checking email delivery
- Redis session storage (`src/lib/kv.ts`) — test by checking session persistence

**3. AI Tool Execution:**
- `matchQuestion` — test by asking questions in different formats
- `collectDetails` — test by entering valid/invalid contact info
- `selectUrgency` — test by selecting urgent/non-urgent and verifying email receipt
- `initiatePayment` — test by proceeding to Stripe checkout
- `uploadDocuments` — test by uploading valid/invalid file types and sizes
- `scheduleAppointment` — test by booking via Calendly embed
- `showUrgentContact` — test by reaching urgent escalation state
- `showOptions` — test by verifying suggestion chips render and respond to clicks

**4. Rate Limiting & Security:**
- Rate limits configured in `src/lib/rate-limit.ts` (Upstash)
- Not directly tested; runtime behavior observed through load testing or logs

**5. Business Logic:**
- Business hours check in `src/lib/contact.ts` (`isInsideBusinessHours()`) — test with different dates/times
- Pricing tiers in `src/lib/stripe.ts` — verify correct amounts displayed and charged
- Session expiry (1hr TTL on Redis) — verify sessions expire and prompt re-entry

## What Gets Manually Tested

**Critical Paths (must test before deployment):**
1. User completes full chat flow: greet → ask question → collect details → select urgency → initiate payment → upload documents (if needed) → confirm booking
2. Stripe payment flow: create checkout session → embedded checkout renders → payment succeeds → session updated
3. Email notifications: client receives inquiry confirmation; firm receives client submission
4. Zapier integration: matter created in Smokeball; documents attached; audit log updated
5. Error paths: network failures logged; user sees fallback messages; no data loss

**Development Testing (before PR):**
- Manual test each feature branch via `npm run dev`
- Check console for errors and warnings (no `[context] message` lines without explanation)
- Verify TypeScript compilation: `npm run build` succeeds
- Run lint: `npm run lint` with no errors
- Test on multiple devices/browsers if UI changes made (especially SpeechRecognition API, which has limited browser support)

## Test Data & Fixtures

**No formal fixtures exist.** Manual test data is used:

**For development:**
- Create `.env.local` with test Stripe keys (via Stripe Dashboard → Developers → API keys)
- Use Stripe's test cards: `4242 4242 4242 4242` (visa success)
- Test phone numbers: `0412 345 678` (Australian format)
- Test email: `test+aquarius@example.com`

**For Smokeball integration:**
- Test Smokeball matter creation webhooks in staging environment
- Verify matter ref mapping in Redis before testing upload flow

**For Calendly:**
- Calendly link is configured in `BRANDING` object — verify link points to test calendar

## Verification Checklist (Manual)

Use this before each release:

```
[ ] TypeScript build succeeds: npm run build
[ ] ESLint passes: npm run lint
[ ] Chat flow works end-to-end (test message → payment → booking)
[ ] Stripe payment succeeded (check Stripe Dashboard)
[ ] Client received inquiry email (check inbox)
[ ] Firm received notification email (check inbox)
[ ] Document upload stores file in Vercel Blob (check Blob Dashboard)
[ ] Redis session persisted (check Upstash Console)
[ ] No console errors logged (check browser DevTools + server logs)
[ ] Smoke test on production-like environment (staging or preview deployment)
```

## Monitoring & Debugging

**Logging Strategy:**
- Check server logs for `[context] error/warn` messages
- Examples from `src/lib/late-upload/handle-completed.ts`:
  - `[late-upload] attach zap failed` → Zapier webhook failed
  - `[late-upload] magic-byte check failed` → File validation failed
  - `[late-upload] head() failed; proceeding without size` → Optional blob metadata missing

**Browser DevTools:**
- Check Network tab for failed API calls
- Check Console for client-side errors
- Check Application → Cookies for session token presence

**Service Dashboards:**
- Stripe Dashboard → Payments: verify charge succeeded
- Upstash Console → Data: verify session data persists
- Vercel Blob Dashboard: verify uploads stored
- Resend Dashboard: verify emails delivered
- Zapier Dashboard: verify webhooks received and executed

## Future Testing Recommendations

**When to Implement Automated Tests:**
1. After code stabilizes (foundation is solid)
2. When team size grows and manual testing becomes bottleneck
3. For critical business paths (payment, data persistence, webhooks)
4. For utility functions with complex logic (`matchQuestion`, `findBestMatch`)

**Recommended Framework Stack:**
- **Runner:** Vitest (better Next.js/ES modules support than Jest)
- **Component testing:** `@testing-library/react` for component behavior
- **Integration testing:** Test API routes with MSW (mock service worker) or actual test fixtures
- **E2E testing:** Playwright or Cypress for full user flows

**Priority Test Coverage:**
1. Validators (`src/lib/validators.ts`) — Unit tests for email/phone/file validation
2. Tools (`src/lib/tools/*.ts`) — Unit tests for Zod validation, execute function behavior
3. API routes (`src/app/api/*.ts`) — Integration tests for request/response handling
4. Components (`src/components/**/*.tsx`) — Render tests for accessibility, user interactions
5. Webhook handlers — Test with realistic payloads from Stripe, Calendly, Smokeball

**Example Test Structure (if implemented):**
```typescript
// src/lib/validators.test.ts
import { describe, it, expect } from "vitest";
import { validateEmail, validatePhone, validateFileSize } from "./validators";

describe("validators", () => {
  describe("validateEmail", () => {
    it("accepts valid email addresses", () => {
      expect(validateEmail("test@example.com")).toBe(true);
    });
    it("rejects invalid email addresses", () => {
      expect(validateEmail("invalid")).toBe(false);
    });
  });

  describe("validatePhone", () => {
    it("accepts Australian mobile numbers", () => {
      expect(validatePhone("0412 345 678")).toBe(true);
      expect(validatePhone("04123456789")).toBe(true); // Normalized format
    });
    it("rejects invalid formats", () => {
      expect(validatePhone("555-1234")).toBe(false); // US format
    });
  });
});
```

---

*Testing analysis: 2026-04-24*
