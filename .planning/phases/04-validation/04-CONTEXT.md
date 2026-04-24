# Phase 4: Validation - Context

**Gathered:** 2026-04-24
**Status:** Ready for planning

<domain>
## Phase Boundary

End-to-end verification of the BPoint payment flow against UAT before production cutover. One happy-path transaction (client → iframe → confirm → fan-out → Smokeball), one Smokeball line-item reconciliation pass, and four failure-path proofs (declined card, expired AuthKey, replayed redirect, webhook retry). Produces a signed evidence bundle that gates production cutover.

No new product features. No new capabilities. Test execution + evidence capture only.

Covers requirements TEST-01, TEST-02, TEST-03.

Out of scope (deferred / other work):
- Shipping new product functionality — all code changes for v1 are done
- Search Transactions API fallback, email-resume flow, refund endpoint, BPoint tokenization — v2 (RESL-01, RESL-02, REFD-01..02, TOKN-01)
- Email-template refresh beyond verifying the existing template renders BPoint-correct content — already handled mechanically in Phase 1, Phase 4 just confirms via UAT evidence
- Production cutover itself — Phase 4 unblocks cutover; the deploy step is an ops task post-sign-off
- Resolving the BPoint Hosted Payment Page product-activation blocker — external, the firm calls support (1300 766 031, Support Code 273 516); Phase 4 cannot start runtime work until that clears

</domain>

<decisions>
## Implementation Decisions

### Test execution shape
- **Hybrid: automated scripts + short manual runbook.** Automated `tests/uat/*.test.ts` (vitest, env-gated by `UAT_SMOKE=1`) covers deterministic server-side paths — confirm-route dedup, webhook dedup, dual-verification response handling, retrieveTransaction smoke call, structured-log shape. Manual runbook covers the iframe card-entry step (live BPoint hosted form can't be reliably scripted) and the Smokeball invoice verification.
- **Live against real UAT** — `tests/uat/` scripts hit the actual Vercel preview deploy + actual BPoint UAT. Not mocked; existing mocked unit tests in `tests/*.test.ts` already cover logic. Phase 4 proves the wiring.
- **One-shot, pre-cutover only.** No CI integration for UAT tests. Scripts are skipped by default; `UAT_SMOKE=1 npm test tests/uat` runs them. CI integration is a deferred idea — avoids BPoint rate-limit risk and secret-management overhead for a one-shot validation.
- **Claude runs everything except Smokeball sign-off.** Operator (Claude/dev) drives UAT scripts, enters test PANs in the iframe, captures screenshots + logs. Firm logs into Smokeball once to verify the test invoice line, screenshots it, signs off. Minimizes firm coordination friction.

### UAT environment
- **Prod host + `BPOINT_ENV=uat`.** Aquarius's BPoint facility is production-only (per `.planning/phases/01-foundation/01-VERIFICATION.md` and commit d2faa18). All UAT runs target `https://www.bpoint.com.au` with `BPOINT_ENV=uat` flipping `IsTestTxn=true` per-call. ROADMAP's `bpoint.uat.linkly.com.au` reference is stale — planner documents the resolution inline in the plan.
- **Vercel preview deploy for the webhook URL.** Phase 4 deploys the validation branch to a Vercel preview, copies the resulting `https://*.vercel.app` origin into `NEXT_PUBLIC_URL` on that preview, and lets `createAuthKey`'s per-AuthKey `ServerNotificationUrl` point BPoint at the preview. No ngrok, no staging env. Mirrors the actual prod wiring path (same Vercel plumbing, just a different URL).
- **Creds: reuse Phase 1.** Existing `BPOINT_USERNAME` (`aquarius-chatbot-uat`), `BPOINT_PASSWORD`, `BPOINT_MERCHANT_NUMBER` (`5353109297032146`) populated on the Vercel preview env, plus `BPOINT_ENV=uat`. No new secrets. Firm provides any missing values via 1Password / secure channel if preview env wasn't previously provisioned.
- **Test cards: BPoint-published UAT PANs + real PRICING.** Use BPoint's documented UAT test PANs for approved, declined, invalid-CVV, expired-card scenarios. Amounts stay at `$1,320 AUD` (urgent) / `$726 AUD` (non-urgent) — real `PRICING` from `src/lib/pricing.ts`, byte-identical `lineItem` strings so Smokeball reconciliation is meaningful. Researcher confirms the current BPoint UAT test PAN list as the single blocking research question.
- **External blocker still governs.** BPoint Hosted Payment Page product activation (call support 1300 766 031, Support Code 273 516, merchant 5353109297032146) gates all runtime validation. Until HPP is activated, AuthKey creation returns `ResponseCode: 2 "Invalid permissions"` — no meaningful UAT can run. Phase 4 plans execute after the firm confirms activation; planning + scripting can start now.

### Failure path induction (TEST-03)
- **Declined card:** operator enters BPoint's UAT declined PAN into the live iframe; iframe submits; redirect lands on confirm route with failing `ResponseCode`/`Approved`; UI renders the "declined" bucket copy. Evidence: screenshot + Vercel log with `bpointTxnNumber` + `[bpoint-confirm]` tag.
- **Expired AuthKey:** operator creates a fresh AuthKey, leaves the iframe idle for **31 minutes**, then clicks Pay. BPoint returns the expired response; UI renders the "expired" bucket + "Start again" button (Phase 2 locked behavior). Authentic TTL exercise — no code patching. Run in parallel with other scenarios while the timer runs.
- **Replayed redirect:** after a successful transaction, extract the `ResultKey` from Vercel logs and `curl GET /api/checkout/confirm?ResultKey=<x>` twice. First call wins SETNX and runs fan-out; second call sees SETNX collision and no-ops. Assert exactly one Resend receipt + one Zapier transcript per `bpointTxnNumber`. Automatable in `tests/uat/confirm-replay.test.ts`.
- **Webhook retry:** two accepted methods. (A) Natural retry — briefly disable the preview deploy so BPoint's first callback fails and retries once the preview comes back. (B) Curl replay — `curl POST /api/webhooks/bpoint?ResultKey=<x>` with the same ResultKey twice against a live preview. Both prove the shared `bpoint-txn:{TxnNumber}` SETNX works across confirm-route + webhook paths. Researcher confirms whether BPoint UAT's retry cadence is observable in logs; if not, method B is sufficient.

### Evidence, sign-off, cutover
- **Per-SC evidence bundle: `.planning/phases/04-validation/04-UAT-EVIDENCE.md`.** Structured sections per success criterion — TEST-01 (happy path screenshot + receipt email snapshot + upload-token URL + Vercel log snippet), TEST-02 (firm's Smokeball invoice-line screenshot + byte-compare vs `src/lib/pricing.ts` `lineItem` string), TEST-03 × 4 (screenshot or log per failure scenario). Mirrors Phase 1/2 `VERIFICATION.md` pattern.
- **Smokeball verification: firm screenshots.** After a successful UAT transaction, the firm opens Smokeball, finds the Zapier-created invoice/matter, screenshots the line items, sends to Claude. Claude compares screenshot text against the locked `lineItem` string. Binary pass/fail. Firm's only required action during Phase 4 execution.
- **Cutover gate: all three SCs green + firm sign-off.** TEST-01, TEST-02, TEST-03 must all show pass in the evidence bundle. Firm acknowledges in writing (email/Slack reply is fine — no legal signature required). Any red means no cutover.
- **Rollback plan: Vercel redeploy to last known-good commit.** Documented in `.planning/phases/04-validation/04-RUNBOOK.md`: Vercel dashboard → redeploy the prior commit; ≤5min procedure. Stripe is fully removed in Phase 3 so "rollback to Stripe" is no longer possible — rollback means reverting to an earlier BPoint commit. Also document manual fan-out replay for support (using `bpointTxnNumber` + logs to resend receipt/transcript if Resend or Zapier flap post-cutover).

### Claude's Discretion
- Exact `tests/uat/` file split (single `uat.test.ts` vs one per scenario) — follow Phase 2 tests/ conventions
- Exact screenshot format and storage location — linked from `04-UAT-EVIDENCE.md`, can live inline as images or in a sibling `screenshots/` dir
- Runbook formatting, section headers, checkbox style — match Phase 1/2 VERIFICATION.md patterns
- Whether to add a `UAT_SMOKE` test-runner guard via `vitest.config.mts` exclude or an `it.skipIf(process.env.UAT_SMOKE !== '1')` per test — either is acceptable
- Whether the evidence bundle is committed to git or sent to the firm separately (lean toward committing since it's design documentation, not customer PII)
- Researcher's exact approach for sourcing BPoint UAT test PAN list (developer docs vs direct support ask)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap + requirements
- `.planning/ROADMAP.md` §Phase 4 — goal, success criteria 1–3 (real UAT transaction, Smokeball reconciliation, 4 failure paths)
- `.planning/REQUIREMENTS.md` — TEST-01, TEST-02, TEST-03 line items; also "Active" section items about email template and lineItem flow (Phase 4 confirms via UAT evidence rather than new code)
- `.planning/PROJECT.md` — Core value + "before cutover" framing; external blocker status (HPP product activation)

### Prior phase context (locked decisions carried forward)
- `.planning/phases/01-foundation/01-CONTEXT.md` — BPoint client shape, PRICING integer cents, `BPOINT_ENV` semantics, `IsTestTxn` per-call evaluation, 30min AuthKey TTL
- `.planning/phases/01-foundation/01-VERIFICATION.md` — **critical for Phase 4**: documents the prod-host-only facility decision (d2faa18), the HPP product-activation external blocker (merchant 5353109297032146, Support Code 273 516), and the runtime probe methodology reused for UAT smoke scripts
- `.planning/phases/02-confirmation-ui/02-CONTEXT.md` — 4 sanitized failure buckets (declined / invalid / system / expired), shared `handleConfirmedPayment` helper, `bpoint-txn:{TxnNumber}` SETNX + 7d TTL dedup, dual verification rule, AuthKey-expiry "Start again" UX
- `.planning/phases/02-confirmation-ui/02-VALIDATION.md` — Phase 2 validation strategy pattern (per-task verify map, sampling rate, manual-only verifications table) — Phase 4's own VALIDATION.md follows the same shape
- `.planning/phases/03-webhook-cleanup/03-CONTEXT.md` — webhook trust-via-retrieve (no shared secret), `ServerNotificationUrl` handoff per-AuthKey, shared dedup namespace with confirm route, Stripe-gone invariant

### Technical research
- `.planning/research/PITFALLS.md` — **critical for Phase 4**: unsigned callbacks (replay safety relies on retrieveTransaction + SETNX, verify during UAT), v5 callback body schema unknown (raw-body snapshot during first prod deploy is a documented deferred idea from Phase 3 that Phase 4 can opportunistically fulfill)
- `.planning/research/STACK.md` — Basic Auth format (`username|merchantnumber:password`), iframe URL pattern, BPoint environment host map (prod host + `IsTestTxn` in lieu of UAT subdomain)
- `.planning/research/FEATURES.md` — BPoint test-PAN ecosystem landing point (researcher continues from here)
- `.planning/research/SUMMARY.md` — research synthesis index

### Codebase maps
- `.planning/codebase/TESTING.md` — existing vitest patterns (though written pre-Phase-2; Phase 4 extends to UAT folder)
- `.planning/codebase/CONVENTIONS.md` — log-tag conventions (`[bpoint-confirm]`, `[bpoint-webhook]`, `[payments]`); UAT log assertions rely on these tags
- `.planning/codebase/INTEGRATIONS.md` — Zapier transcript monitoring contract (must be unchanged post-cutover); Redis session shape

### Existing code to read before planning UAT scripts
- `src/lib/pricing.ts` — byte-identical `lineItem` strings for Smokeball reconciliation assertion
- `src/lib/bpoint.ts` — `createAuthKey`, `retrieveTransaction`, per-call `IsTestTxn` logic; UAT smoke scripts exercise these live
- `src/app/api/checkout/confirm/route.ts` — dual verification + SETNX dedup path under test
- `src/app/api/webhooks/bpoint/route.ts` — webhook path under test
- `src/lib/payments/handleConfirmedPayment.ts` — shared fan-out; UAT confirms exactly-once semantics end-to-end
- `tests/confirm-route.test.ts`, `tests/webhook-bpoint.test.ts`, `tests/handle-confirmed-payment.test.ts` — unit-level analogs of what UAT exercises live; structural templates for `tests/uat/*.test.ts`

### External (researcher reference)
- BPoint UAT test PAN list — researcher sources from BPoint developer docs or direct support ask; **single blocking research question** for Phase 4 planning
- BPoint Retrieve Transaction v2 API — `retrieveTransaction` is called from UAT scripts against real transactions
- BPoint HPP product activation — `1300 766 031`, Support Code `273 516`, merchant `5353109297032146`; phase runtime gated on this
- Zapier / Smokeball test workspace — firm confirms whether test transcript emails route to a sandbox Smokeball or the production workspace (affects TEST-02 procedure)
- Vercel dashboard — where preview env vars are set + where rollback is performed

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Full unit-test suite (49/49 green from Phase 3)** — `tests/bpoint.test.ts`, `tests/bucket-bank-code.test.ts`, `tests/confirm-route.test.ts`, `tests/handle-confirmed-payment.test.ts`, `tests/webhook-bpoint.test.ts`, `tests/payment-card.test.tsx`, `tests/chat-widget.test.tsx`. UAT scripts mirror the structural shape — same fixtures, same mocking style, swap mocks for live fetches gated by `UAT_SMOKE=1`.
- **`tests/fixtures/bpoint-responses.ts`** — approved/declined/invalid/expired canned responses. UAT scripts can reuse fixture shapes as type assertions against live responses.
- **`src/lib/bpoint.ts#retrieveTransaction`** — called directly from UAT scripts (with real UAT creds) to verify happy-path and each failure-response shape.
- **`src/lib/pricing.ts`** — exported `PRICING` + `lineItem` strings used as the ground-truth for the Smokeball reconciliation check.
- **`vitest.config.mts`** — already wired; Phase 4 either adds a `tests/uat` include-pattern with env gate, or uses per-test `it.skipIf(!process.env.UAT_SMOKE)`.

### Established Patterns
- **Phase 1/2 VERIFICATION.md style** — frontmatter + Observable Truths table + Required Artifacts table + Human-Verification section. Phase 4's `04-UAT-EVIDENCE.md` adopts the same structure with per-SC rows.
- **Bracket-prefix structured logging** (`[bpoint-confirm]`, `[bpoint-webhook]`, `[payments]`) — UAT scripts grep Vercel logs by these tags for evidence capture.
- **Named exports only, path alias `@/`** — UAT scripts follow the same conventions.
- **No test-only code in prod paths** — induction methods are external (real PANs, real 30min wait, curl replay, natural retry); no dev-only flags added to `src/`.

### Integration Points
- **Vercel preview deploy** — `NEXT_PUBLIC_URL` on the preview env becomes both the `RedirectionUrl` base (confirm route) and `ServerNotificationUrl` base (webhook). Setting the env var is a manual Vercel dashboard step documented in the runbook.
- **BPoint UAT creds on Vercel preview env** — same variable names as `.env.example`, with `BPOINT_ENV=uat` to flip `IsTestTxn=true` via `src/lib/bpoint.ts`'s per-call evaluation.
- **Firm's Smokeball workspace** — Zapier routes transcript emails there; firm screenshots the resulting invoice lines. No Claude-side integration; just an evidence handoff.
- **Vercel logs** — single observability surface; UAT evidence cites log snippets by `bpointTxnNumber` + bracket tag for each scenario.

</code_context>

<specifics>
## Specific Ideas

- The evidence bundle should read like a court-admissible record — for every success criterion a support engineer should be able to see exactly what happened without re-running anything. Screenshots + log snippets + byte-compares, not prose.
- The 31-minute expiry wait is a feature, not a drag. Run it in parallel with the happy-path and failure scenarios so dead time is zero.
- Byte-comparing the Smokeball invoice's lineItem text against `src/lib/pricing.ts` is the single most legally load-bearing assertion in the whole phase — it proves the Zapier contract survived the Stripe→BPoint migration. Treat it as a hard pass/fail, no wiggle room.
- First prod deploy: opportunistically log `req.text()` on `/api/webhooks/bpoint` for N days (the deferred Phase 3 idea) to finally capture the real v5 callback body schema. Planner can fold this in as a low-risk addition under Claude's discretion.
- `tests/uat/` runs against real BPoint UAT — **never wire it into default CI** without a kill switch; a merge storm could rate-limit the firm's BPoint facility.

</specifics>

<deferred>
## Deferred Ideas

- CI integration for `tests/uat/` — add once post-cutover stability is established; requires BPoint rate-limit analysis and secret-management strategy
- Separate UAT BPoint facility (isolated from prod merchant) — firm can request later if audit separation becomes a requirement
- Playwright end-to-end flow driving the BPoint iframe — fragile against third-party DOM; revisit only if manual regression burden grows
- Automated Smokeball API check in lieu of firm screenshot — requires Smokeball API access + auth; firm screenshot is sufficient for v1
- Synthetic monitor alerting on `bpoint-txn:*` dedup collisions (a signal the webhook consistently wins the race) — future observability, not a v1 need
- Raw-body snapshot logging on `/api/webhooks/bpoint` — opportunistic during first prod deploy; Phase 4 planner may include as a low-risk add
- Email-based resume flow, Search Transactions fallback, refunds, BPoint tokenization — v2 roadmap (RESL-01..02, REFD-01..02, TOKN-01)
- PowerBoard migration — far-future; out of scope per REQUIREMENTS.md

</deferred>

---

*Phase: 04-validation*
*Context gathered: 2026-04-24*
