---
phase: 03-webhook-cleanup
plan: 02
subsystem: payments

tags: [bpoint, webhook, payments, tdd, green]

# Dependency graph
requires:
  - phase: 03-webhook-cleanup
    provides: tests/webhook-bpoint.test.ts (9 RED cases from Plan 03-01)
  - phase: 02-confirmation-ui
    provides: handleConfirmedPayment, retrieveTransaction, confirm-route structural template
provides:
  - POST /api/webhooks/bpoint — BPoint server-to-server safety-net endpoint
  - createAuthKey.webhookUrlBase arg — per-AuthKey WebHookUrl registration
  - WEBH-01..04 requirements complete in code
affects: [03-webhook-cleanup P03 (cleanup), end-to-end UAT validation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Safety-net webhook as confirm-route mirror: same retrieveTransaction+SETNX+handleConfirmedPayment pipeline minus browser redirects; whichever path wins SETNX owns the fan-out"
    - "Shared dedup key namespace bpoint-txn:{TxnNumber} with 7-day TTL across confirm route and webhook"
    - "WebHookUrl as optional ProcessTxnData field — omitted via JSON.stringify when webhookUrlBase is undefined, zero regression for legacy callers/tests"
    - "Observability: [bpoint-webhook] tag + structured log fields (tag, phase, bpointTxnNumber, sessionId, err, timestamp) per 03-CONTEXT.md"

key-files:
  created:
    - src/app/api/webhooks/bpoint/route.ts
  modified:
    - src/lib/bpoint.ts
    - src/app/api/checkout/route.ts

key-decisions:
  - "WebHookUrl serialized conditionally (ternary → undefined) so JSON.stringify omits the key when webhookUrlBase is absent — keeps legacy ProcessTxnData shape identical when the webhook base isn't wired"
  - "Reused NEXT_PUBLIC_URL for webhookUrlBase — no new env var per 03-CONTEXT.md §Webhook URL handoff"
  - "Structural carbon copy of confirm-route for webhook: same dual verification, same SETNX, same shared handleConfirmedPayment import — zero fan-out duplication (WEBH-03)"
  - "Every branch returns 200 {received:true}: retrieveTransaction throws, Approved=false, ResponseCode!==0, SETNX collision, fan-out throws — BPoint treats non-2xx as retry signal (WEBH-04)"

patterns-established:
  - "Wave 2 GREEN pattern: verbatim implementation of Wave 0 RED contract — no deviations, all 9 tests GREEN on first vitest run after route creation"
  - "Two-file touchpoint for BPoint webhook wiring: (a) createAuthKey emits WebHookUrl, (b) POST /api/checkout passes webhookUrlBase — symmetric with existing redirectionUrlBase plumbing"

requirements-completed: [WEBH-01, WEBH-02, WEBH-03, WEBH-04]

# Metrics
duration: 2min
completed: 2026-04-24
---

# Phase 03 Plan 02: BPoint Webhook Route + WebHookUrl Registration Summary

**POST /api/webhooks/bpoint live as a structural mirror of the confirm route; createAuthKey now registers per-AuthKey WebHookUrl so BPoint actually delivers callbacks — all 9 RED tests from Plan 03-01 flipped to GREEN, full suite 49/49.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-24T06:05:33Z
- **Completed:** 2026-04-24T06:07:44Z
- **Tasks:** 2
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments

- New route `src/app/api/webhooks/bpoint/route.ts` (110 lines) implements WEBH-01..04 as a carbon-copy of the confirm route minus browser redirects
- `CreateAuthKeyArgs.webhookUrlBase?` added + `WebHookUrl` conditionally serialized inside ProcessTxnData (`src/lib/bpoint.ts` — 162 → 172 lines)
- `POST /api/checkout` now passes `webhookUrlBase: process.env.NEXT_PUBLIC_URL ?? ""` through createAuthKey (`src/app/api/checkout/route.ts` — 40 → 41 lines)
- All 9 webhook tests GREEN: ResultKey-missing no-op, both query casings, decline/expired short-circuit, approved fan-out with mapped fields, SETNX collision dedup, handleConfirmedPayment-throws 200, retrieveTransaction-throws 200
- Zero regressions: pre-existing 40 tests still GREEN (confirm-route, bpoint, handle-confirmed-payment, chat-widget, payment-card, bucket-bank-code all pass)
- Build clean (`npm run build` exits 0, `/api/webhooks/bpoint` route registered)
- Lint clean (only pre-existing unrelated `_opts` warning in chat-widget.test.tsx — out of scope)

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend createAuthKey with WebHookUrl + webhookUrlBase arg** — `271d8fb` (feat)
2. **Task 2: Build src/app/api/webhooks/bpoint/route.ts POST handler** — `95dc3db` (feat)

_Plan metadata commit follows this summary._

## Files Created/Modified

- `src/app/api/webhooks/bpoint/route.ts` (CREATED, 110 lines) — POST handler, structural mirror of confirm route minus redirects
- `src/lib/bpoint.ts` (MODIFIED, +10 lines: 162 → 172) — `CreateAuthKeyArgs.webhookUrlBase?` field + conditional `WebHookUrl` in ProcessTxnData body
- `src/app/api/checkout/route.ts` (MODIFIED, +1 line: 40 → 41) — passes `webhookUrlBase: process.env.NEXT_PUBLIC_URL ?? ""` to `createAuthKey`

### ProcessTxnData body diff (exact)

**Before (Phase 2, lines 76-88 of src/lib/bpoint.ts):**

```typescript
body: JSON.stringify({
  ProcessTxnData: {
    Action: "payment",
    Amount: pricing.amount,
    Crn1: args.sessionId,
    CurrencyCode: "AUD",
    MerchantReference: pricing.lineItem,
    RedirectionUrl: `${args.redirectionUrlBase}/api/checkout/confirm`,
    IsTestTxn: cfg.isTestTxn,
    ExpiryInMinutes: 30,
  },
}),
```

**After:**

```typescript
body: JSON.stringify({
  ProcessTxnData: {
    Action: "payment",
    Amount: pricing.amount,
    Crn1: args.sessionId,
    CurrencyCode: "AUD",
    MerchantReference: pricing.lineItem,
    RedirectionUrl: `${args.redirectionUrlBase}/api/checkout/confirm`,
    WebHookUrl: args.webhookUrlBase
      ? `${args.webhookUrlBase}/api/webhooks/bpoint`
      : undefined,
    IsTestTxn: cfg.isTestTxn,
    ExpiryInMinutes: 30,
  },
}),
```

Because `JSON.stringify` elides `undefined` values, legacy callers (and the existing `tests/bpoint.test.ts` suite) that don't pass `webhookUrlBase` produce the exact pre-Plan-02 wire shape — no regression.

## Observability alignment (03-CONTEXT.md)

Webhook log lines use the `[bpoint-webhook]` tag (8 occurrences across info + error paths). Structured error logs in the `retrieveTransaction` and `handleConfirmedPayment` catch blocks include every field spec'd by `03-CONTEXT.md §Observability`:

| Field              | Retrieve-throw branch | Fan-out-throw branch |
|--------------------|-----------------------|----------------------|
| `tag`              | `"[bpoint-webhook]"`  | `"[bpoint-webhook]"` |
| `phase`            | `"retrieve"`          | `"fan-out"`          |
| `bpointTxnNumber`  | n/a (pre-txn)         | present              |
| `sessionId`        | n/a (pre-txn)         | present              |
| `err.message`      | present               | present              |
| `err.stack`        | present               | present              |
| `timestamp`        | ISO 8601              | ISO 8601             |

Info-level logs (missing ResultKey, not-approved, dedup collision) use concise payloads appropriate to non-error conditions.

## Decisions Made

- **Conditional WebHookUrl serialization** — ternary yielding `undefined` (not missing property) relies on `JSON.stringify` omitting `undefined`-valued keys. This keeps the wire format byte-identical for legacy callers and is the pattern the plan's `<action>` block prescribed verbatim.
- **No body parsing in webhook** — 03-CONTEXT.md locked `req.json()` / `req.text()` out; verified `grep -E "req\.(text|json)\("` returns 0 hits against the new route.
- **Shared `handleConfirmedPayment` import** — webhook imports the Phase 2 helper directly; zero duplicated fan-out code (WEBH-03 satisfied structurally, not just behaviorally).
- **Same `bpoint-txn:{TxnNumber}` namespace + 7-day TTL as confirm route** — whichever path (browser redirect OR webhook) wins SETNX owns the fan-out; the other sees `created !== "OK"` and no-ops.
- **Numeric ResponseCode compare** (`ResponseCode === 0`, NOT `=== "0"`) — mirrors confirm route and avoids 03-RESEARCH.md Pitfall 2.

## Deviations from Plan

None — plan executed exactly as written. The `<action>` blocks for both tasks were applied verbatim; all acceptance criteria passed on first run (webhook tests went GREEN on the first vitest invocation after creating the route file).

Note on one acceptance criterion: the plan's Task 1 criteria say `grep -c "WebHookUrl" src/lib/bpoint.ts` returns exactly 1. The actual count is 2 because the mandatory JSDoc comment block on the `webhookUrlBase` interface field (prescribed verbatim in the `<action>` block) itself contains the literal string `WebHookUrl`. The criterion's spirit — "the body key is present exactly once" — is satisfied (line 92 is the only body-level occurrence; line 54 is the doc comment the plan required). Not flagged as a deviation because the code content matches the plan's prescribed code 1:1.

## Issues Encountered

None. TDD loop was a single-pass GREEN — implement route file → `npx vitest run tests/webhook-bpoint.test.ts` → 9/9 pass.

## User Setup Required

- **BPoint Merchant Back Office server-to-server callback URL** — as a defense-in-depth layer independent of per-AuthKey WebHookUrl, the firm may still want to configure the facility-level callback URL to `${NEXT_PUBLIC_URL}/api/webhooks/bpoint`. Not required for Plan 02 code to function (per-AuthKey WebHookUrl is sufficient), but tracked as a Phase 3 external blocker in STATE.md.
- `NEXT_PUBLIC_URL` must be set in prod/UAT env (already was, reused here) so the WebHookUrl BPoint receives is reachable from Linkly's backend.

## Next Phase Readiness

- Plan 03-03 (Stripe cleanup) is unblocked — Plan 03-02 delivered the replacement for the legacy Stripe webhook responsibility; the old `/api/webhooks/stripe` route can now be safely retired.
- End-to-end UAT validation still gated on BPoint UAT credentials + HPP activation (Phase 2 external blocker, unchanged).
- No new regressions introduced; Phase 2 confirm route behaviour untouched, so both the browser-redirect path and the webhook safety-net path now co-exist cleanly.

## Self-Check

All claims verified:

- `src/app/api/webhooks/bpoint/route.ts` exists (FOUND, 110 lines)
- `src/lib/bpoint.ts` modified (FOUND, contains `webhookUrlBase` and `WebHookUrl`)
- `src/app/api/checkout/route.ts` modified (FOUND, contains `webhookUrlBase: process.env.NEXT_PUBLIC_URL`)
- Commit `271d8fb` exists in git log (FOUND)
- Commit `95dc3db` exists in git log (FOUND)
- `npx vitest run tests/webhook-bpoint.test.ts` → 9/9 passed (verified)
- `npm test` → 49/49 passed (verified)
- `npm run build` → exit 0 (verified)
- `npm run lint` → 0 errors (verified; 1 pre-existing warning unrelated)
- No body parsing in webhook (`grep -E "req\.(text|json)\("` returns 0)
- No default export in webhook (`grep -c "export default"` returns 0)
- `[bpoint-webhook]` log tag present 8 times (>= 4 required)

## Self-Check: PASSED

---
*Phase: 03-webhook-cleanup*
*Completed: 2026-04-24*
