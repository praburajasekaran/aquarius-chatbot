# UAT Smoke Tests (Phase 4)

Live tests that hit real BPoint UAT + a real Vercel preview deploy. NOT unit tests.

## Why these are gated

- Default `npm test` excludes `tests/uat/**` (see `vitest.config.mts` exclude block).
- Each file also guards with `describe.skipIf(!process.env.UAT_SMOKE)`.
- CI must NEVER set `UAT_SMOKE=1`. Accidental runs count against the firm's BPoint
  facility rate limits and may create spurious test charges against the prod host.

## Prerequisites

1. BPoint Hosted Payment Page product must be activated at the facility level.
   Call BPoint support 1300 766 031, Support Code 273 516, merchant 5353109297032146
   (see `.planning/phases/01-foundation/01-VERIFICATION.md`). Until activated,
   AuthKey creation returns `ResponseCode: 2 "Invalid permissions"` — no meaningful UAT.
2. Vercel preview deploy live on the Phase 4 branch with these env vars set
   (Preview scope, branch-scoped):
   - `BPOINT_API_USERNAME=aquarius-chatbot-uat`
   - `BPOINT_API_PASSWORD=<from 1Password>`
   - `BPOINT_MERCHANT_NUMBER=5353109297032146`
   - `BPOINT_ENV=uat`
   - `NEXT_PUBLIC_URL=https://<project>-git-<branch>-<team>.vercel.app` (branch-alias, NOT commit hash)
3. A successful happy-path transaction has been run so `UAT_RESULT_KEY` is known
   (capture from Vercel logs, tag `[bpoint-confirm]`).

## How to run

```bash
# Local invocation with env pulled from Vercel preview
vercel env pull .env.uat.local --environment=preview --git-branch=<branch>
export $(grep -v '^#' .env.uat.local | xargs)
export UAT_SMOKE=1
export UAT_PREVIEW_URL=https://aquarius-chatbot-git-<branch>-<team>.vercel.app
export UAT_RESULT_KEY=<uuid-from-vercel-log>
npx vitest run tests/uat
```

## Safety guards

Every test file imports `assertUatGate()` + `assertPreviewUrl()` from `./setup.ts`.
- `assertUatGate()` throws if `UAT_SMOKE !== "1"`.
- `assertPreviewUrl()` throws if `UAT_PREVIEW_URL` does not contain `.vercel.app`.

## Files

- `setup.ts` — shared guard helpers
- `fixtures/test-pans.ts` — BPoint-published UAT PANs + magic expiry/CVN table
- `happy-path.test.ts` — TEST-01 live retrieve round-trip (Plan 02)
- `retrieve-transaction.test.ts` — TEST-01 bpoint-client smoke (Plan 02)
- `confirm-replay.test.ts` — TEST-03 replayed redirect dedup (Plan 03)
- `webhook-retry.test.ts` — TEST-03 webhook retry dedup (Plan 03)
- `declined-card.test.ts` — TEST-03 declined response code (Plan 03)

## Do NOT

- Add this directory to CI.
- Change `PRICING` amounts for testing — BPoint's amount-based response-code
  simulation uses the last two digits of the amount as the bank response code
  ($132000 → `00` approved is not accidental). Use magic expiry `99XX` instead.
- Use Playwright or automated iframe fill — BPoint iframe is cross-origin and
  automation is explicitly deferred to v2.
