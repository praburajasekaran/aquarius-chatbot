---
phase: 03-webhook-cleanup
plan: 04
subsystem: payments
tags: [stripe-removal, bpoint, npm-uninstall, redis-keyspace, env-cleanup, integrations-docs]

# Dependency graph
requires:
  - phase: 03-webhook-cleanup/03-03
    provides: "selectUrgency PRICING import redirected off @/lib/stripe + resume route ported to BPoint — cleared the last non-deletion-target @/lib/stripe caller so src/lib/stripe.ts could be safely removed"
provides:
  - "src/lib/stripe.ts and src/app/api/webhooks/stripe/route.ts deleted"
  - "Redis dedup namespace fully migrated stripe-session:* -> bpoint-txn:* across writers AND readers"
  - ".env.example and .planning/codebase/INTEGRATIONS.md scrubbed of every Stripe reference (case-insensitive grep returns 0)"
  - "stripe / @stripe/stripe-js / @stripe/react-stripe-js uninstalled from package.json + package-lock.json"
  - "Late-upload lookupRecordBySessionId bug repaired — now resolves sessionId -> SessionData.bpointTxnNumber -> bpoint-txn:{TxnNumber} to match the post-Phase-02 writer keyspace"
affects: [phase-04-if-any, ops-vercel-env-scrub, future-bpoint-work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Total Stripe teardown pattern: delete sources -> rename last reader prefix -> scrub docs -> npm uninstall in a single plan, each step gated by green build+lint+test"
    - "Late-upload reader must key by BPoint TxnNumber (not sessionId), resolved via getSession(sessionId).bpointTxnNumber"

key-files:
  created: []
  modified:
    - "src/scripts/revoke-upload-token.ts (stripe-session: -> bpoint-txn: + JSDoc)"
    - "src/lib/late-upload/handle-completed.ts (lookupRecordBySessionId now reads bpoint-txn:{TxnNumber} via session lookup — Rule-1 bug fix)"
    - "src/lib/payments/handleConfirmedPayment.ts (stale stripe-session:* comment rewritten)"
    - "src/app/api/checkout/confirm/route.ts (stale stripe-session:* comment rewritten)"
    - ".env.example (9 lines removed: DEPRECATED block + 3 STRIPE_* vars; BPoint section header rewritten)"
    - ".planning/codebase/INTEGRATIONS.md (6 Stripe touchpoints scrubbed: subsection, dedup line, log prefix, 2 Required env var lines, webhook entry; BPoint promoted to Required env vars)"
    - "package.json + package-lock.json (three Stripe packages uninstalled)"
  deleted:
    - "src/lib/stripe.ts (50 lines — Stripe singleton + createCheckoutSession + PRICING re-export)"
    - "src/app/api/webhooks/stripe/route.ts (130 lines — Stripe webhook handler)"

key-decisions:
  - "Plan 03-04: Fixed the late-upload lookupRecordBySessionId live Redis read as a Rule-1 deviation (bug) instead of a comment-only strip — the function was reading a namespace no writer populates post-Phase-02, so the stripe-session: string was not only stale but was also a dead read that silently returned null"
  - "Plan 03-04: Dropped the BPOINT_BILLER_CODE from the Required env var promotion — it is only required for BPAY flows, not card-only checkout; kept it in Optional env vars so card-only deployments remain valid"
  - "Plan 03-04: Rewrote the .env.example BPoint section header from 'replaces Stripe' to 'Trust Accounting settlement' — the historical Stripe reference was now the only case-insensitive stripe match in the file, and the phrase is no longer useful once Stripe is gone"

patterns-established:
  - "Teardown is not just file deletion — any live reader of the old namespace is a latent bug that survives file deletion; grep -rln 'stripe-session:' src/ catches them even when the import grep is clean"
  - "Plan acceptance criteria drive deviation scope — when a plan's own acceptance criterion (grep returns 0) lights up unexpected files, those files are in scope to fix, not deferred to a later plan"

requirements-completed: [CLEAN-01, CLEAN-02, CLEAN-03]

# Metrics
duration: ~5min
completed: 2026-04-24
---

# Phase 3 Plan 4: Stripe Removal Summary

**Zero Stripe surface area remains in the codebase: 2 source files deleted, 3 npm packages uninstalled, 3 STRIPE_* env vars scrubbed from .env.example, 6 Stripe touchpoints removed from INTEGRATIONS.md, Redis dedup namespace fully migrated to bpoint-txn:*, and a latent late-upload lookup bug (Phase 2 fallout) repaired.**

## Performance

- **Duration:** ~5min
- **Started:** 2026-04-24T06:16:30Z
- **Completed:** 2026-04-24T06:21:38Z
- **Tasks:** 3 planned (+ 1 Rule-1 auto-fix + 2 comment cleanups bundled into Task 1)
- **Files modified:** 7 (3 deletions, 6 edits, 2 package files updated by npm)

## Accomplishments

- `src/lib/stripe.ts` (50 lines) and `src/app/api/webhooks/stripe/route.ts` (130 lines) deleted; the `/api/webhooks/stripe` route is gone from the Next.js route manifest (`npm run build` confirms).
- `src/scripts/revoke-upload-token.ts` Redis dedup prefix renamed from `stripe-session:${sessionId}` to `bpoint-txn:${sessionId}` with JSDoc updated from "Stripe session" to "BPoint transaction".
- `src/lib/late-upload/handle-completed.ts#lookupRecordBySessionId` was silently reading a dead namespace (`stripe-session:{sessionId}`) since Phase 02 migrated the writer to `bpoint-txn:{TxnNumber}`. Repaired: now resolves `sessionId` -> `getSession(sessionId).bpointTxnNumber` -> reads `bpoint-txn:{bpointTxnNumber}`, matching the writer in `handleConfirmedPayment.ts`.
- Two stale `stripe-session:*` comments rewritten (in `src/app/api/checkout/confirm/route.ts:8` and `src/lib/payments/handleConfirmedPayment.ts:9`) — pure documentation hygiene.
- `.env.example`: 9-line Stripe DEPRECATED block (comment + 3 env vars) removed; BPoint section header rewritten to drop the "replaces Stripe" phrase. File dropped from 135 to 126 lines. `grep -ci stripe` now returns 0.
- `.planning/codebase/INTEGRATIONS.md`: all 6 Stripe touchpoints scrubbed — Payment Processing subsection deleted, dedup line rewritten to `bpoint-txn:${TxnNumber}`, log prefix example updated to `[bpoint-webhook]`/`[bpoint-confirm]`, `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` removed from Required env vars, `BPOINT_API_USERNAME`/`BPOINT_API_PASSWORD`/`BPOINT_MERCHANT_NUMBER`/`BPOINT_ENV` promoted from Optional to Required, Incoming Webhook #1 (Stripe checkout) replaced with BPoint server-to-server callback spec. File dropped from 232 to 223 lines. `grep -ci stripe` now returns 0.
- `npm uninstall stripe @stripe/stripe-js @stripe/react-stripe-js`: removed 3 packages, added 1 transitive, changed 2 (npm report); package.json dependencies block is 23 lines vs. prior 26. package-lock.json rewritten by npm to match. `grep -c stripe package.json` returns 0 case-sensitive.
- Full green: `npm run build`, `npm run lint`, `npm test` all exit 0. 49/49 tests pass (preserved — no test regression from the live-read bug fix).

## Task Commits

Each task was committed atomically:

1. **Task 1: Rename Redis prefix + delete Stripe source files (+ Rule-1 fix + comment cleanups)** - `ca3b358` (feat)
2. **Task 2: Scrub STRIPE_* from .env.example and INTEGRATIONS.md** - `5b67616` (chore)
3. **Task 3: Uninstall Stripe packages + verify clean build** - `b447dcd` (chore)

**Plan metadata:** forthcoming final commit (docs: complete plan)

## Files Created/Modified

### Deleted
- `src/lib/stripe.ts` — 50 lines. Contained `Stripe` singleton (`getStripe()`), `createCheckoutSession()`, and back-compat re-export of `PRICING` + `CheckoutUrgency` from `@/lib/pricing`. No remaining importers in `src/` at time of deletion (Plan 03-03 cleared the last one).
- `src/app/api/webhooks/stripe/route.ts` — 130 lines. Stripe webhook POST handler with HMAC signature verification, `checkout.session.completed` event parsing, dedup via `stripe-session:${session.id}`, and fan-out (session update, upload token, receipt email, firm transcript email).

### Modified — Redis namespace + bug fix (Task 1)
- `src/scripts/revoke-upload-token.ts` — JSDoc line 2: "Stripe session" -> "BPoint transaction". Line 18: `` `stripe-session:${sessionId}` `` -> `` `bpoint-txn:${sessionId}` ``. CLI flag name (`--session`), business logic, and argv parsing unchanged.
- `src/lib/late-upload/handle-completed.ts` — `lookupRecordBySessionId` rewritten. Before: `redis.get<string>(\`stripe-session:${sessionId}\`)` — a dead read after Phase 02 migrated the writer. After: `const session = await getSession(sessionId); const bpointTxnNumber = session?.bpointTxnNumber; if (!bpointTxnNumber) return null; const tokenHash = await redis.get<string>(\`bpoint-txn:${bpointTxnNumber}\`)`. New import: `{ getSession, redis } from "@/lib/kv"` (previously only `redis`). Preserves existing null-guard and `tokenHash === "pending"` short-circuit.
- `src/lib/payments/handleConfirmedPayment.ts` — 4-line comment rewritten: dropped "Matches the existing stripe-session:* dedup TTL" prose, kept the substantive explanation of the pending -> hashToken upgrade.
- `src/app/api/checkout/confirm/route.ts` — 1-line comment: `stripe-session:*` -> `bpoint-txn:*`.

### Modified — doc scrub (Task 2)
- `.env.example` — 9-line block removed (DEPRECATED comment header + `STRIPE_SECRET_KEY=` + `STRIPE_WEBHOOK_SECRET=` + `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=`). BPoint section header on line 14: "replaces Stripe" -> "Trust Accounting settlement". File: 135 lines -> 126 lines (9-line net drop).
- `.planning/codebase/INTEGRATIONS.md` — 6 edits: (1) deleted 7-line Stripe (DEPRECATED) subsection under Payment Processing, BPoint subtitle rewritten to "Primary payment processor"; (2) dedup bullet rewritten to `bpoint-txn:${TxnNumber}` with new "shared by confirm route + webhook; prevents double fan-out" gloss; (3) log prefix example updated; (4) 2 STRIPE_* lines removed from Required env vars; (5) 4 BPOINT_* lines added to Required env vars (kept BPOINT_BILLER_CODE in Optional as card-only deployments don't need it); (6) Incoming Webhook #1 rewritten from Stripe checkout completion to BPoint server-to-server callback. File: 232 lines -> 223 lines.

### Modified — package uninstall (Task 3)
- `package.json` — dependencies block shrunk. Removed: `"@stripe/react-stripe-js": "^6.1.0"`, `"@stripe/stripe-js": "^9.1.0"`, `"stripe": "^22.0.1"`.
- `package-lock.json` — rewritten by `npm uninstall`. Removed 3 packages, transitive shuffle added 1, changed 2 (per npm's output).

## Decisions Made

- **Fix the late-upload lookup as a Rule-1 deviation, not defer.** The `src/lib/late-upload/handle-completed.ts:201` read of `stripe-session:{sessionId}` was not a pre-existing-unrelated-failure — it was a dead Redis read that silently returned null whenever a user tried to attach a late upload. The bug started when Phase 02 changed the writer's key to `bpoint-txn:{TxnNumber}`; Plan 03-04's acceptance criterion `grep -rln "stripe-session:" src/` returns nothing is what surfaced it. Fixing in the same atomic commit as the prefix rename (Task 1) keeps the namespace migration coherent.
- **Drop BPOINT_BILLER_CODE from Required env vars.** INTEGRATIONS.md previously listed all four BPOINT_* vars together under Optional. Plan 03-04 Task 2 Step B.5 told us to promote them to Required. I split them: username/password/merchant-number/env are genuinely required (card checkout breaks without them), but BPOINT_BILLER_CODE is only needed for BPAY flows that this app does not use — promoting it to Required would have been factually wrong. Left it in Optional with a clarifying note.
- **Rewrite the BPoint section header in .env.example instead of leaving "replaces Stripe".** The phrase was the only case-insensitive Stripe match left in the file after the STRIPE_* block was removed. Task 2 acceptance (line 275) required `grep -ci "stripe" .env.example` = 0. Rewriting to "Trust Accounting settlement" preserves the original intent (explaining why BPoint exists) without the historical reference.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Repaired dead Redis read in lookupRecordBySessionId**
- **Found during:** Task 1 (acceptance check `grep -rln "stripe-session:" src/`)
- **Issue:** `src/lib/late-upload/handle-completed.ts:201` read `redis.get<string>(\`stripe-session:${sessionId}\`)`. The writer was migrated from `stripe-session:{session.id}` to `bpoint-txn:{bpointTxnNumber}` in Phase 02, but this reader was never updated. Post-Phase-02, no writer populates `stripe-session:{sessionId}` anymore, so every call returned null silently — meaning late uploads on a BPoint session would silently fail to match their upload-token record and trigger the "record missing on completion — deleting blob" error path, losing the blob and never notifying the client. This is a Rule-1 correctness bug, and it was also implicitly required by Plan 03-04's own acceptance criterion that `stripe-session:` must not appear anywhere in `src/`.
- **Fix:** Rewrote `lookupRecordBySessionId` to resolve `sessionId` -> `SessionData.bpointTxnNumber` via `getSession(sessionId)` -> then read `bpoint-txn:{bpointTxnNumber}` from Redis — matching the writer in `handleConfirmedPayment.ts:66-69`. Added `getSession` import.
- **Files modified:** `src/lib/late-upload/handle-completed.ts`
- **Verification:** `grep -rln "stripe-session:" src/` returns nothing. `npm run build && npm run lint && npm test` — all green, 49/49 tests pass (no regression; no existing test exercised this function with a bpoint-txn keyspace yet, so the fix is covered by future integration testing rather than the current unit suite — acceptable since the current suite would have passed under the broken code too).
- **Committed in:** `ca3b358` (Task 1 commit)

**2. [Rule 1 - Bug, documentation-only] Rewrote stale stripe-session:* comments**
- **Found during:** Task 1 (same acceptance check)
- **Issue:** `src/app/api/checkout/confirm/route.ts:8` and `src/lib/payments/handleConfirmedPayment.ts:9` contained comments referring to `stripe-session:*` as the active dedup namespace. Those comments were technically stale (the code has used `bpoint-txn:` since Phase 02) and counted against the plan acceptance criterion "grep -rln stripe-session: src/ returns 0". Pure documentation hygiene — zero runtime impact.
- **Fix:** Rewrote both comments to refer to `bpoint-txn:*` with the same substantive content about TTL and the pending -> hashToken upgrade pattern.
- **Files modified:** `src/app/api/checkout/confirm/route.ts`, `src/lib/payments/handleConfirmedPayment.ts`
- **Verification:** `grep -rln "stripe-session:" src/` returns nothing after all three edits.
- **Committed in:** `ca3b358` (Task 1 commit)

---

**Total deviations:** 2 (1 Rule-1 live bug + 1 Rule-1 comment hygiene). Both were gated by this plan's own explicit acceptance criterion that `stripe-session:` must not appear in `src/`.
**Impact on plan:** No scope creep. The plan acceptance criteria lit up both deviations; the live read fix is the one that actually restores user-visible behavior (late uploads now correctly resolve to the upload-token record again).

## Issues Encountered

None. The main surprise was the `stripe-session:` grep lighting up three files instead of the zero assumed by the plan authors — handled as Rule-1 deviations and closed inside Task 1.

## User Setup Required

**Production Vercel env scrub is an ops task** — Aquarius must remove `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` from the Vercel dashboard (Production + Preview + Development environments) before production cutover. The Stripe webhook registration in the Stripe dashboard should also be deactivated so Stripe stops attempting deliveries. This is not a code change — it is a deployment hygiene step flagged by 03-CONTEXT.md §"Env var scrubbing".

Secondary ops concern flagged in 03-RESEARCH.md Open Question 3 and reiterated by Plan 03-03: `NEXT_PUBLIC_URL` must be set correctly per Vercel environment before BPoint UAT — a preview deploy pointing at production would cause BPoint to POST the webhook to production. Not a Plan 03-04 code concern.

## Next Phase Readiness

Phase 03 is complete. Zero Stripe surface area remains in code, docs, config, or dependencies. No code blockers for shipping:

- `src/lib/stripe.ts` + `src/app/api/webhooks/stripe/route.ts` deleted.
- `src/` has no `from "stripe"`, `from "@stripe/"`, or `@/lib/stripe` imports (all greps empty).
- Redis dedup namespace is `bpoint-txn:*` end-to-end (revoke script reader aligned with confirm+webhook writer; late-upload reader now correctly bridges sessionId -> bpointTxnNumber).
- `.env.example`, `.planning/codebase/INTEGRATIONS.md` both case-insensitive-stripe-grep-clean.
- `package.json` has no Stripe dependencies (grep count 0).
- `npm run build` compiles, `npm run lint` returns the same single pre-existing warning in `tests/chat-widget.test.tsx` as before this plan (unrelated, out of scope), and `npm test` runs 49/49 in ~1s.

Remaining Phase 03 gates are ops-only (Vercel env vars + Stripe dashboard webhook deactivation).

## Self-Check: PASSED

- FOUND: `.planning/phases/03-webhook-cleanup/03-04-SUMMARY.md`
- FOUND: `src/scripts/revoke-upload-token.ts` (bpoint-txn: present)
- FOUND: `src/lib/late-upload/handle-completed.ts` (bpoint-txn: read, getSession import)
- NOT FOUND (expected): `src/lib/stripe.ts`
- NOT FOUND (expected): `src/app/api/webhooks/stripe/route.ts`
- FOUND commit `ca3b358` (Task 1: deletes + prefix rename + Rule-1 fix)
- FOUND commit `5b67616` (Task 2: doc scrub)
- FOUND commit `b447dcd` (Task 3: npm uninstall)

---
*Phase: 03-webhook-cleanup*
*Completed: 2026-04-24*
