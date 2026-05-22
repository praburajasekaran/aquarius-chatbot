# Phase 4: Validation — Research

**Researched:** 2026-04-24
**Domain:** End-to-end UAT validation of the BPoint payment flow before production cutover — test-execution planning, evidence capture, vitest env-gating, Vercel preview plumbing
**Confidence:** HIGH for test-PAN rules / vitest gate pattern / Vercel preview wiring; MEDIUM for BPoint webhook retry cadence; LOW for BPoint v5 callback body schema (opaque in public docs)

## Summary

Phase 4 is a validation-only phase — no new product code. The job is to stand up a Vercel preview deploy that points at BPoint UAT (prod host + `BPOINT_ENV=uat`), script deterministic server-side checks under `tests/uat/*.test.ts`, execute a short manual runbook for the non-scriptable pieces (iframe card entry + Smokeball screenshots), and produce a per-SC evidence bundle that gates production cutover.

Three research findings materially shape the plan. **First**, BPoint does not publish scenario-specific test PANs the way Stripe does — response codes are simulated via **transaction amount** (last two digits) or **magic expiry date** (`99XX`), with one recommended test PAN per scheme (MasterCard `5123456789012346`, Visa `4987654321098769`, etc.). This is a fundamentally different mental model from Stripe's PAN-per-scenario and directly affects how the UAT runbook describes failure-path induction. **Second**, BPoint's public v5 webhook documentation does not expose callback-body schema or retry cadence — the Phase 3 decision to "trust via retrieveTransaction only" is the right defensive posture, and curl-replay (CONTEXT Method B) is the definitive TEST-03 webhook-retry induction method because BPoint retry cadence is not observable in documentation. **Third**, Vercel preview URLs auto-generated per-commit are unstable (`*-git-{branch}-{team}.vercel.app` branch alias is stable; `*-{hash}.vercel.app` commit alias is not) — the runbook must pin `NEXT_PUBLIC_URL` to the branch-alias form so BPoint's per-AuthKey `ServerNotificationUrl` keeps resolving across re-deploys.

**Primary recommendation:** Use BPoint's documented amount-based + expiry-based response-code simulation (not a fictional "declined PAN list") in `tests/uat/`, gate the suite via per-test `it.skipIf(!process.env.UAT_SMOKE)` + a `tests/uat/**` glob exclusion in `vitest.config.mts` (both layers — env gate is skip-visible, exclude gate prevents default runs), and pin the Vercel preview URL via branch-alias to keep BPoint's registered `ServerNotificationUrl` stable.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Test execution shape**
- **Hybrid: automated scripts + short manual runbook.** Automated `tests/uat/*.test.ts` (vitest, env-gated by `UAT_SMOKE=1`) covers deterministic server-side paths — confirm-route dedup, webhook dedup, dual-verification response handling, retrieveTransaction smoke call, structured-log shape. Manual runbook covers the iframe card-entry step (live BPoint hosted form can't be reliably scripted) and the Smokeball invoice verification.
- **Live against real UAT** — `tests/uat/` scripts hit the actual Vercel preview deploy + actual BPoint UAT. Not mocked; existing mocked unit tests in `tests/*.test.ts` already cover logic. Phase 4 proves the wiring.
- **One-shot, pre-cutover only.** No CI integration for UAT tests. Scripts are skipped by default; `UAT_SMOKE=1 npm test tests/uat` runs them. CI integration is a deferred idea.
- **Claude runs everything except Smokeball sign-off.** Operator (Claude/dev) drives UAT scripts, enters test PANs in the iframe, captures screenshots + logs. Firm logs into Smokeball once to verify the test invoice line, screenshots it, signs off.

**UAT environment**
- **Prod host + `BPOINT_ENV=uat`.** Aquarius's BPoint facility is production-only. All UAT runs target `https://www.bpoint.com.au` with `BPOINT_ENV=uat` flipping `IsTestTxn=true` per-call. ROADMAP's `bpoint.uat.linkly.com.au` reference is stale (see `.planning/phases/01-foundation/01-VERIFICATION.md`, commit d2faa18).
- **Vercel preview deploy for the webhook URL.** Phase 4 deploys the validation branch to a Vercel preview, copies the resulting `https://*.vercel.app` origin into `NEXT_PUBLIC_URL` on that preview, and lets `createAuthKey`'s per-AuthKey `ServerNotificationUrl` point BPoint at the preview. No ngrok, no staging env.
- **Creds: reuse Phase 1.** Existing `BPOINT_API_USERNAME` (`aquarius-chatbot-uat`), `BPOINT_API_PASSWORD`, `BPOINT_MERCHANT_NUMBER` (`5353109297032146`) populated on the Vercel preview env, plus `BPOINT_ENV=uat`. No new secrets.
- **Test cards: BPoint-published UAT PANs + real PRICING.** Amounts stay at `$1,320 AUD` (urgent) / `$726 AUD` (non-urgent) — real `PRICING` from `src/lib/pricing.ts`, byte-identical `lineItem` strings.
- **External blocker still governs.** BPoint HPP product activation (call support 1300 766 031, Support Code 273 516, merchant 5353109297032146) gates all runtime validation. Until HPP is activated, AuthKey creation returns `ResponseCode: 2 "Invalid permissions"` — no meaningful UAT can run. Planning + scripting can start now.

**Failure path induction (TEST-03)**
- **Declined card:** operator enters BPoint's UAT declined PAN (see Research below — actually: valid PAN + amount ending in a decline code or expiry `99XX`) into the live iframe; iframe submits; redirect lands on confirm route with failing `ResponseCode`/`Approved`; UI renders the "declined" bucket copy. Evidence: screenshot + Vercel log with `bpointTxnNumber` + `[bpoint-confirm]` tag.
- **Expired AuthKey:** operator creates a fresh AuthKey, leaves the iframe idle for **31 minutes**, then clicks Pay. BPoint returns the expired response; UI renders the "expired" bucket + "Start again" button. Authentic TTL exercise — no code patching.
- **Replayed redirect:** after a successful transaction, extract the `ResultKey` from Vercel logs and `curl GET /api/checkout/confirm?ResultKey=<x>` twice. First call wins SETNX and runs fan-out; second call sees SETNX collision and no-ops. Assert exactly one Resend receipt + one Zapier transcript per `bpointTxnNumber`. Automatable in `tests/uat/confirm-replay.test.ts`.
- **Webhook retry:** two accepted methods. (A) Natural retry — briefly disable the preview deploy so BPoint's first callback fails and retries once the preview comes back. (B) Curl replay — `curl POST /api/webhooks/bpoint?ResultKey=<x>` twice against a live preview.

**Evidence, sign-off, cutover**
- **Per-SC evidence bundle: `.planning/phases/04-validation/04-UAT-EVIDENCE.md`.** Structured sections per success criterion. Mirrors Phase 1/2 `VERIFICATION.md` pattern.
- **Smokeball verification: firm screenshots.** Binary pass/fail byte-compare against `src/lib/pricing.ts` `lineItem` string.
- **Cutover gate: all three SCs green + firm sign-off.**
- **Rollback plan: Vercel redeploy to last known-good commit.** Documented in `.planning/phases/04-validation/04-RUNBOOK.md`. Stripe is gone — rollback means reverting to an earlier BPoint commit. Also document manual fan-out replay.

### Claude's Discretion

- Exact `tests/uat/` file split (single `uat.test.ts` vs one per scenario) — follow Phase 2 tests/ conventions
- Exact screenshot format and storage location — linked from `04-UAT-EVIDENCE.md`, can live inline as images or in a sibling `screenshots/` dir
- Runbook formatting, section headers, checkbox style — match Phase 1/2 VERIFICATION.md patterns
- Whether to add a `UAT_SMOKE` test-runner guard via `vitest.config.mts` exclude or an `it.skipIf(process.env.UAT_SMOKE !== '1')` per test — either is acceptable
- Whether the evidence bundle is committed to git or sent to the firm separately (lean toward committing)
- Researcher's exact approach for sourcing BPoint UAT test PAN list — resolved below via official BPoint v3/v5 docs

### Deferred Ideas (OUT OF SCOPE)

- CI integration for `tests/uat/`
- Separate UAT BPoint facility (isolated from prod merchant)
- Playwright end-to-end flow driving the BPoint iframe
- Automated Smokeball API check in lieu of firm screenshot
- Synthetic monitor alerting on `bpoint-txn:*` dedup collisions
- Raw-body snapshot logging on `/api/webhooks/bpoint` — opportunistic during first prod deploy; Phase 4 planner may include as a low-risk add
- Email-based resume flow, Search Transactions fallback, refunds, BPoint tokenization — v2 (RESL-01..02, REFD-01..02, TOKN-01)
- PowerBoard migration
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TEST-01 | End-to-end test against BPoint UAT environment succeeds with real test transactions | Confirmed UAT model: prod host + `BPOINT_ENV=uat` flips `IsTestTxn=true` per-call (Phase 1 d2faa18). Recommended test PAN: `5123456789012346` (MasterCard) with future-dated expiry + urgent/non-urgent amounts from `src/lib/pricing.ts` ($1,320.00 = 132000 cents; $726.00 = 72600 cents). Amount-based response code = last two digits of amount — e.g. `132000` → bank response code `00` (approved). See Standard Stack → "BPoint UAT test-card conventions". |
| TEST-02 | Zapier → Smokeball invoice sync verified — line items reconcile correctly with BPoint receipt data | `src/lib/pricing.ts` holds the ground-truth `lineItem` strings (`Initial Deposit for Urgent Court Matter`, `Legal Strategy Session`). `MerchantReference` in `src/lib/bpoint.ts:90` is already bound to `pricing.lineItem`. Firm screenshots the Smokeball invoice line; Claude byte-compares screenshot OCR / transcribed text against the constant. Binary pass/fail. |
| TEST-03 | Failure paths tested — declined card, expired AuthKey, webhook retry, redirect without callback | Four induction methods documented below in "Failure Path Induction Matrix". Declined via expiry `9905` ("Do not honour"); invalid-CVV via CVN `987`; expired-card via expiry `9933` or `9954`; expired AuthKey via 31-minute idle (`ExpiryInMinutes: 30` + buffer); replayed redirect via `curl` double-hit; webhook retry via curl replay against the shared `bpoint-txn:{TxnNumber}` SETNX namespace. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `vitest` | `^2.1.9` (already installed) | Test runner for `tests/uat/*.test.ts` smoke scripts | Used Phase-2 onwards; config in `vitest.config.mts`; `test` script is `vitest run --reporter=dot`. Already supports jsdom/node environment matrix. |
| `curl` | system | Webhook replay + confirm-route replay induction, Vercel log tailing | Language-agnostic, documentable in the runbook, no new deps. Matches Phase 1 runtime-probe methodology (`.planning/phases/01-foundation/01-VERIFICATION.md`). |
| Vercel preview deploy | platform | Hosts the validation branch with UAT env vars, gives BPoint a reachable `ServerNotificationUrl` | Mirrors production plumbing — same auto-build, same runtime, just a different origin. No ngrok tunnel variance. |
| Vercel CLI (optional) | `latest` | `vercel env pull` to sync preview env vars locally; `vercel logs` to follow preview logs | Optional — Vercel dashboard UI can do both, CLI is faster for an operator already in terminal. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| BPoint UAT test PAN | `5123456789012346` (MC primary); Visa `4987654321098769` | Card-number field in the BPoint hosted iframe | Use MasterCard by default — BPoint docs explicitly recommend it. Visa fallback if the UAT facility is MC-restricted. |
| Magic expiry `99XX` | — | Force specific bank response codes independent of amount | `9905` → Bank code `05` "Do not honour" (declined). `9933` / `9954` → "Expired card". Use when amount must stay pinned to real PRICING ($1,320 / $726). |
| Magic CVN values | `987`, `876`, `765` | Force CVN response codes | `987` returns CVN response "N" + bank code `05`. Useful for invalid-CVV bucket testing without changing amount or expiry. |
| Magic amount `11199` | — | Simulate 50-second timeout → `PT_G5` response | Only needed if the operator wants to exercise the `retrieveTransaction` HTTP timeout path. Not a declared TEST-03 scenario; document as an optional probe. |

### BPoint UAT test-card conventions (HIGH confidence)

BPoint's UAT follows a **response-code-simulation** model, not a "PAN-per-scenario" model like Stripe. There is **one recommended test PAN per card scheme**; the bank response is driven by either the transaction amount or a magic expiry date.

**Recommended test PANs** (BPoint v3 docs, `bpoint.com.au/developers/v3/partialViews/Sections/testmodetxn/description.html`):

| Card Type | Test PAN |
|-----------|----------|
| MasterCard | `5123456789012346` (BPoint's documented default) |
| MasterCard 2-Series | `2720010040360012` |
| Visa | `4987654321098769` |
| American Express | `345678901234564` |
| Diners | `30123456789019` |
| JCB | `3530111333300000` |

**Response-code simulation rules:**

1. **Amount-based (Method 1):** With a normally-formatted future-dated expiry, the bank response code equals the **last two digits of the transaction amount**. E.g., amount `$132000` (cents) → last two digits `00` → "Approved". Amount `132005` → `05` "Do not honour". **Implication for Aquarius:** `$1,320.00 = 132000` naturally returns code `00` (approved). `$726.00 = 72600` also ends in `00`. This is why the happy path works without any contortion.

2. **Expiry-based (Method 2):** With an expiry of the form `99XX` (e.g., `99/05`), the response code is `XX`. **This is the Aquarius-preferred method** for induce-failure scenarios because it preserves the real PRICING amounts (byte-identical `lineItem` reconciliation with Smokeball depends on amount stability).

3. **CVN-based:** Specific CVN values (`987`, `876`, `765`) force CVN-response codes without affecting amount/expiry.

4. **Timeout:** Amount `11199` ($111.99) triggers a 50-second delay then `PT_G5` response.

**Sources:**
- `https://bpoint.com.au/developers/v3/partialViews/Sections/testmodetxn/description.html` (HIGH — authoritative BPoint v3 docs; v5 test-mode page is a React SPA and not crawlable but references the same rules)
- `https://www.bpoint.com.au/developers/v5/reference/test-mode` (MEDIUM — reference page confirmed via search summary: "specific parameters can be provided to obtain specific simulated bank response codes…")
- `https://www.bpoint.com.au/backoffice/media/documents/Testing(Phone,Internet,DDCC).pdf` (HIGH — official PDF; linked from BPoint's backoffice docs)

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Magic expiry `99XX` (preserve amount) | Magic amount (append `05` to 132000 → 132005) | Breaks the Smokeball reconciliation assertion because the amount no longer matches PRICING. **Rejected** for this project. |
| Per-test `it.skipIf(!process.env.UAT_SMOKE)` | `vitest.config.mts` glob exclude `tests/uat/**` | Skip is visible in reporter output (good — makes the gate explicit); exclude is silent. **Use both layers** (belt-and-braces: exclude keeps `tests/uat/` out of the default run; `skipIf` is a second defense if someone later changes include patterns). |
| Vercel preview deploy | ngrok tunnel to localhost | ngrok URL is ephemeral; preview URL is stable per-branch; preview mirrors prod runtime. **Rejected** ngrok. |
| Playwright automated iframe fill | Manual iframe entry + screenshot | Playwright against third-party DOM is fragile; BPoint iframe fields are cross-origin so Playwright can't reach into them without disabling same-origin policy. **Rejected** (listed in CONTEXT Deferred). |

**Installation (nothing new):**
```bash
# No new npm packages required. vitest + Vercel preview already in the stack.
# Vercel CLI (optional, for log streaming):
npm install -g vercel
```

**Version verification:**
```bash
npm view vitest version    # confirm stable release is still 2.x
```
Vitest 2.1.9 is already pinned in `package.json`. As of April 2026, vitest 2.x is stable; vitest 3.x exists but CONTEXT locks us to "follow Phase 2 conventions" — no upgrade in Phase 4.

## Architecture Patterns

### Recommended Project Structure

```
tests/
├── setup.ts                      # existing — polyfills scrollIntoView + RTL cleanup
├── fixtures/
│   └── bpoint-responses.ts       # existing — reused as type-assertion shapes
├── uat/                          # NEW: live-UAT smoke tests (env-gated)
│   ├── README.md                 # how to run, prerequisites, env vars
│   ├── confirm-replay.test.ts    # TEST-03 replayed redirect
│   ├── webhook-replay.test.ts    # TEST-03 webhook retry
│   ├── retrieve-smoke.test.ts    # TEST-01 smoke: createAuthKey + retrieve round-trip
│   └── log-shape.test.ts         # structured-log grep assertions
└── *.test.ts                     # existing mocked unit tests (unchanged)

.planning/phases/04-validation/
├── 04-CONTEXT.md                 # existing
├── 04-RESEARCH.md                # this file
├── 04-VALIDATION.md              # nyquist validation — see section below
├── 04-UAT-EVIDENCE.md            # NEW — per-SC evidence bundle (runtime artefact)
├── 04-RUNBOOK.md                 # NEW — manual steps operator follows
├── 04-00-PLAN.md                 # Wave 0: env plumbing + UAT test scaffolds
├── 04-01-PLAN.md                 # Wave 1: UAT smoke scripts
├── 04-02-PLAN.md                 # Wave 2: runbook execution + evidence capture
├── 04-03-PLAN.md                 # Wave 3 (optional): raw-body logging add for Phase 3 deferred idea
└── screenshots/                  # NEW — linked from 04-UAT-EVIDENCE.md
    ├── sc1-happy-path.png
    ├── sc2-smokeball-invoice-line.png
    ├── sc3-declined.png
    ├── sc3-expired-authkey.png
    ├── sc3-replayed-redirect.log
    └── sc3-webhook-retry.log
```

### Pattern 1: Env-gated vitest suite (two-layer gate)

**What:** Prevent `tests/uat/*` from running during the default `npm test` invocation and during CI; only run when operator explicitly opts in with `UAT_SMOKE=1`.

**When to use:** Any test that makes live outbound HTTP calls to paid or rate-limited external services. Here: BPoint UAT + Vercel preview.

**Example (`vitest.config.mts`):**
```typescript
// Source: https://vitest.dev/config/ (HIGH confidence, official docs)
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

const runUat = process.env.UAT_SMOKE === "1";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "node",
    environmentMatchGlobs: [
      ["tests/**/*.test.tsx", "jsdom"],
      ["tests/payment-card.test.tsx", "jsdom"],
    ],
    setupFiles: ["./tests/setup.ts"],
    globals: false,
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: runUat
      ? ["node_modules/**", "dist/**"]
      : ["node_modules/**", "dist/**", "tests/uat/**"],
  },
});
```

**Example (`tests/uat/confirm-replay.test.ts`):**
```typescript
// Source: https://vitest.dev/api/test (HIGH confidence — test.skipIf is a documented primitive)
import { describe, it, expect } from "vitest";

const UAT_GATE = process.env.UAT_SMOKE === "1";

describe.skipIf(!UAT_GATE)("confirm route — replayed redirect dedup", () => {
  it("two GETs with same ResultKey fire fan-out exactly once", async () => {
    const previewUrl = process.env.UAT_PREVIEW_URL;
    const resultKey = process.env.UAT_RESULT_KEY; // captured from happy-path run
    // ... two-shot curl or fetch, assert single Resend log line
  });
});
```

**Why two layers:** The `exclude` keeps `tests/uat/` out of `npm test` silently (prevents accidental CI runs; no red herring skip-counts in reports). The `describe.skipIf` inside each UAT file is a redundant defense so if someone later unchains the exclude (or runs a specific `tests/uat/foo.test.ts` file directly), the env gate still catches them.

### Pattern 2: Vercel preview env-var wiring for BPoint UAT

**What:** Set `BPOINT_API_USERNAME`, `BPOINT_API_PASSWORD`, `BPOINT_MERCHANT_NUMBER`, `BPOINT_ENV=uat`, and `NEXT_PUBLIC_URL` on the preview environment so that:
1. `src/lib/bpoint.ts:24` reads `BPOINT_ENV !== "prod"` → `IsTestTxn=true` per-call
2. `createAuthKey`'s `ServerNotificationUrl` = `${NEXT_PUBLIC_URL}/api/webhooks/bpoint` resolves to the live preview origin BPoint can reach

**When to use:** Any time the BPoint preview must accept a real callback (i.e., always for TEST-01 and the natural-retry variant of TEST-03).

**Example dashboard flow:**
1. Open Vercel dashboard → Project → Settings → Environment Variables.
2. For each of `BPOINT_API_USERNAME`, `BPOINT_API_PASSWORD`, `BPOINT_MERCHANT_NUMBER`: select **Preview** environment, scope to the validation branch (`claude/modest-hermann-dda08b` or whatever the Phase 4 branch is), paste secret, Save.
3. Add `BPOINT_ENV=uat` scoped the same way.
4. Push a commit to trigger preview deploy.
5. After deploy, note the **branch-alias URL** (format `https://<project>-git-<branch>-<team>.vercel.app`) — this is stable across commits on the branch. Do NOT use the commit-specific alias (`https://<project>-<hash>-<team>.vercel.app`) because it changes every redeploy.
6. Set `NEXT_PUBLIC_URL` on the preview env to the branch-alias URL from step 5.
7. Redeploy (env-var changes do not auto-apply to existing deployments — see "Common Pitfalls → Pitfall: Env-var changes are deployment-scoped").

**Reference:** `https://vercel.com/docs/environment-variables#preview-environment-variables` (HIGH confidence, official docs)
**Reference:** `https://vercel.com/docs/deployments/environments` — "Branch-specific URL – Always points to the latest changes on that branch" (HIGH)

### Pattern 3: Shared-namespace dedup assertion

**What:** After the happy-path payment, the operator (or an automated UAT test) captures `ResultKey` from Vercel logs (`[bpoint-confirm]` tag) and replays it against both `/api/checkout/confirm` and `/api/webhooks/bpoint`. Because both routes SETNX on the shared `bpoint-txn:{TxnNumber}` namespace (Phase 3 locked decision), the second caller loses and no-ops. Evidence is a single Resend receipt and a single Zapier transcript per `bpointTxnNumber`.

**When to use:** TEST-03 replayed-redirect and webhook-retry scenarios.

**Example (`tests/uat/confirm-replay.test.ts`):**
```typescript
it("second confirm-route hit sees SETNX collision", async () => {
  const url = `${process.env.UAT_PREVIEW_URL}/api/checkout/confirm?ResultKey=${process.env.UAT_RESULT_KEY}&ResponseCode=0`;
  const first = await fetch(url, { redirect: "manual" });
  const second = await fetch(url, { redirect: "manual" });
  expect(first.status).toBe(307);
  expect(second.status).toBe(307);
  // Second call's Vercel log MUST contain "[bpoint-confirm] duplicate ignored"
  // — assert by log tail in the runbook, not by fetch response (which is identical).
});
```

**Note:** The duplicate-ignored signal is **only** visible in Vercel logs, not in the HTTP response (both return a redirect). Evidence-capture must include the log snippet; the test alone doesn't prove dedup.

### Anti-Patterns to Avoid

- **Automated iframe card-entry via Playwright/Puppeteer:** BPoint iframe is cross-origin and its DOM is not stable across versions. Playwright cannot reach into a cross-origin iframe without breaking same-origin policy, and BPoint explicitly forbids automation in its test-mode docs.
- **Hardcoding a fabricated "UAT declined PAN":** BPoint does not have declined/approved PAN pairs. Writing `const DECLINED_PAN = "4000..."` in the runbook creates a false contract with BPoint's actual behavior.
- **Using the commit-specific Vercel URL in `NEXT_PUBLIC_URL`:** Every redeploy creates a new commit-specific alias. BPoint's `ServerNotificationUrl` was registered per-AuthKey at AuthKey-creation time; a stale URL means callbacks go to a dead deploy.
- **Running `tests/uat/` without `UAT_SMOKE=1`:** Risks hitting the firm's BPoint facility from a developer's machine or CI, which counts against their BPoint rate limits.
- **Asserting `IsTestTxn` purely from code:** `src/lib/bpoint.ts` evaluates `process.env.BPOINT_ENV` per-call. The runtime assertion is "look at the outbound request body in Vercel logs for `IsTestTxn: true`." Don't re-test the environment logic at UAT time (that's a Phase 1 concern).
- **Mixing happy-path and failure-path runs in the same Smokeball test workspace without labeling:** Zapier may create multiple matters in rapid succession. Label each test transaction with a distinctive `Crn1` sessionId (e.g., `uat-2026-04-24-happy`, `uat-2026-04-24-declined`) so the firm can filter the right one in Smokeball.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| BPoint test-card "fake declined" matrix | Custom PAN→scenario map | Magic expiry `99XX` + documented CVN/amount rules | BPoint's test-mode contract already covers every scenario; a custom map drifts from BPoint's actual behavior. |
| HTTPS tunnel from localhost to BPoint | ngrok tunnel | Vercel preview deploy | Preview is the real production runtime; ngrok is a different HTTP path with different TLS behavior. |
| Webhook-signature verification | Custom HMAC check | Trust-via-retrieveTransaction (Phase 3 locked) | BPoint v2/v5 callbacks are unsigned; the only safe pattern is to re-fetch canonical state from BPoint. |
| Payment-flow automation via browser driver | Playwright against BPoint iframe | Manual iframe fill + screenshot | Cross-origin iframe DOM access is blocked by browsers; automation against third-party DOM is fragile. |
| Smokeball data-fetch for reconciliation | Smokeball API integration | Firm screenshot + text transcription | Smokeball API requires auth + workspace setup; firm screenshot is sufficient for a one-shot gate (CONTEXT Deferred idea). |
| UAT-only env-var parser | Custom `UAT_SMOKE=1` guard file | Built-in `it.skipIf` + vitest `exclude` | Vitest already supports env-gated tests natively. |

**Key insight:** Phase 4 is a **composition of existing pieces**, not new capability. Every component (vitest, curl, Vercel preview, BPoint test mode, shared SETNX namespace) already exists and is documented elsewhere — the Phase 4 artifacts are runbooks and assertions over those pieces.

## Common Pitfalls

### Pitfall 1: Using commit-specific Vercel URL → stale `ServerNotificationUrl`

**What goes wrong:** Operator sets `NEXT_PUBLIC_URL=https://aquarius-chatbot-abc123-praburajasekaran.vercel.app` (commit-specific alias). Next commit triggers a new preview with hash `def456`. The old URL now points to a dead deploy. BPoint's callback — registered at AuthKey creation with the old URL — hits a 404 on retry.

**Why it happens:** Vercel auto-generates commit-specific URLs and displays them prominently in the dashboard PR comment. The branch-alias URL is less visible.

**How to avoid:** Use the **branch-alias URL** format: `https://aquarius-chatbot-git-<branch-slug>-<team-slug>.vercel.app`. This URL always resolves to the latest commit on the branch and is stable across redeploys. Create AuthKeys only after the preview for the latest commit is live.

**Warning signs:** `curl` against `NEXT_PUBLIC_URL` after a redeploy returns 404 or shows an older commit's content; BPoint callback logs show HTTP 4xx/5xx at the preview.

**Source:** `https://vercel.com/docs/deployments/environments` — "Branch-specific URL – Always points to the latest changes on that branch" (HIGH).

### Pitfall 2: Env-var changes don't apply to existing deployments

**What goes wrong:** Operator updates `BPOINT_ENV=uat` in the Vercel dashboard, then runs the UAT test against the existing preview URL. The old deploy still has the old (or missing) env value → `IsTestTxn=false` → a real charge could be attempted (it won't succeed because HPP is un-activated, but the behavior is wrong and masks testing).

**Why it happens:** Vercel docs explicitly state: "Any change you make to environment variables are not applied to previous deployments, they only apply to new deployments."

**How to avoid:** After every env-var change, trigger a redeploy (push an empty commit or use the dashboard "Redeploy" button). Verify the new env is active by hitting a debug-env endpoint or inspecting `[bpoint]` log output for the expected `BPOINT_ENV` value (do NOT log the secrets; log a derived boolean like `isTestTxn`).

**Warning signs:** Env-var UI shows new value but `IsTestTxn` in logs shows the old behavior.

**Source:** `https://vercel.com/docs/environment-variables` (HIGH).

### Pitfall 3: BPoint amount-based response codes change the happy path if amount drifts

**What goes wrong:** Operator assumes they can use any test amount. Runs `$132.05` (132005 cents) as a probe — BPoint returns bank code `05` "Do not honour". Operator thinks the gateway is broken.

**Why it happens:** BPoint's amount-based simulation uses the last two digits of the amount as the bank response code. The PRICING amounts `132000` and `72600` end in `00` by deliberate accident of the dollar figure — this is why the happy path works without contortion.

**How to avoid:** **Never change the PRICING amounts for testing** (they're also the ground truth for TEST-02 reconciliation). Use **magic expiry `99XX`** to force bank response codes instead. Document the amount-convention in the runbook so operators don't accidentally use `$132.05` as a test amount.

**Warning signs:** Unexpected bank code matching the last two digits of a test amount.

**Source:** `https://bpoint.com.au/developers/v3/partialViews/Sections/testmodetxn/description.html` (HIGH).

### Pitfall 4: Forgetting to disable-then-re-enable the preview for natural webhook retry

**What goes wrong:** Operator plans the "natural retry" webhook test (CONTEXT TEST-03 method A). Pauses the preview deploy (Vercel dashboard → Deployment Protection toggle, or rename the branch to a non-preview branch). BPoint's first callback fails. Operator re-enables the preview but never gets the retry — because BPoint's retry cadence is **not publicly documented** and may be a single retry within N seconds, or may never retry at all.

**Why it happens:** BPoint v2/v5 webhook documentation does not expose retry policy. Third-party gateway surveys (Spreedly, Linkly) do not document it either. The retry behavior is a black box.

**How to avoid:** **Default to Method B (curl replay) for TEST-03 webhook-retry**. Method A is a nice-to-have that proves natural retry but is not reliable. Document this explicitly in the runbook. The curl-replay method exercises the same SETNX path and is the authoritative proof that dedup works; BPoint's actual retry cadence is orthogonal to what TEST-03 needs to assert.

**Warning signs:** You're staring at logs waiting for a retry that never comes.

### Pitfall 5: Mismatched `lineItem` string between BPoint MerchantReference and Smokeball display

**What goes wrong:** The `lineItem` string in `src/lib/pricing.ts` flows through `src/lib/bpoint.ts:90` (`MerchantReference: pricing.lineItem`) and also through the Zapier transcript email (`src/lib/resend.ts`). If either flow truncates or reformats the string before it reaches Smokeball, TEST-02 reconciliation fails even though the code is correct.

**Why it happens:** BPoint may truncate `MerchantReference` to 24 chars (typical legacy gateway limit); Zapier may HTML-decode or URL-encode the field differently; Smokeball may display a truncated preview in invoice lines.

**How to avoid:** During TEST-02 verification, byte-compare the **firm's screenshot OCR / transcription** against `PRICING.urgent.lineItem` exactly. If truncation is observed: (a) confirm whether the truncation is at BPoint MerchantReference or at Smokeball display; (b) if at BPoint, Phase 4 discovers a post-hoc bug that requires either a pricing-side rename (risks reconciliation with historical Stripe invoices) or a separate transcript-email field (Zapier re-map). This is in-scope for Phase 4 — discovery is the validation goal.

**Warning signs:** Smokeball line reads "Initial Deposit for Urgent Court Ma…" or similar partial text.

### Pitfall 6: `tests/uat/` accidentally tripwires CI or pre-commit hook

**What goes wrong:** A future PR author (or a pre-commit hook) runs `npm test` without realizing UAT gating exists. Because the `exclude` layer isn't obvious from `package.json`, confusion ensues — or worse, an `it.skipIf` is the only gate and CI surface-reports 50 "skipped" tests that a reviewer treats as failing.

**Why it happens:** Single-layer gates fail silently in unexpected ways.

**How to avoid:** Apply the two-layer gate (vitest `exclude` + `it.skipIf`) and document the gating in `tests/uat/README.md` at the top of the directory. Include a note in the CI config (if one gets added later) explicitly allow-listing `UAT_SMOKE` as unset.

**Warning signs:** CI reports skipped UAT tests even though CI shouldn't know they exist.

### Pitfall 7: Running UAT tests against production by accident

**What goes wrong:** Operator sets `UAT_PREVIEW_URL=https://aquariuslawyers.com.au` (production) instead of the preview URL. Live clients' inboxes may receive test emails; the firm's real Smokeball workspace gets a test matter.

**Why it happens:** Copy-paste error; UAT and preview URLs look similar.

**How to avoid:** Add a runtime guard at the top of every `tests/uat/*.test.ts` that asserts the URL contains `.vercel.app`:
```typescript
beforeAll(() => {
  const url = process.env.UAT_PREVIEW_URL ?? "";
  if (!url.includes(".vercel.app")) {
    throw new Error(`[uat-guard] UAT_PREVIEW_URL must be a Vercel preview URL (.vercel.app). got: ${url}`);
  }
});
```

**Warning signs:** Tests pass but the firm reports seeing test transactions in production Smokeball.

## Code Examples

### Example 1: UAT happy-path smoke test (retrieve + log shape)

```typescript
// Source: tests/confirm-route.test.ts structural template; src/lib/bpoint.ts retrieveTransaction (HIGH confidence — codebase conventions)
// tests/uat/retrieve-smoke.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { retrieveTransaction } from "@/lib/bpoint";

const UAT_GATE = process.env.UAT_SMOKE === "1";

describe.skipIf(!UAT_GATE)("BPoint UAT — retrieveTransaction smoke", () => {
  beforeAll(() => {
    if (!process.env.BPOINT_API_USERNAME) {
      throw new Error("[uat-guard] BPOINT_* creds not set — vercel env pull first");
    }
    if (process.env.BPOINT_ENV !== "uat") {
      throw new Error(`[uat-guard] BPOINT_ENV must be 'uat', got: ${process.env.BPOINT_ENV}`);
    }
  });

  it("returns a valid BPointTxnResponse shape for a known ResultKey", async () => {
    const resultKey = process.env.UAT_RESULT_KEY;
    if (!resultKey) throw new Error("Set UAT_RESULT_KEY from a recent happy-path run");

    const txn = await retrieveTransaction(resultKey);

    expect(txn.APIResponse).toBeDefined();
    expect(typeof txn.APIResponse.ResponseCode).toBe("number");
    if (txn.TxnResp) {
      expect(txn.TxnResp).toMatchObject({
        TxnNumber: expect.any(String),
        Approved: expect.any(Boolean),
        Amount: expect.any(Number),
        BankResponseCode: expect.any(String),
      });
    }
  });
});
```

### Example 2: Confirm-route replay dedup test

```typescript
// Source: src/app/api/checkout/confirm/route.ts SETNX contract (HIGH — codebase)
// tests/uat/confirm-replay.test.ts
import { describe, it, expect } from "vitest";

const UAT_GATE = process.env.UAT_SMOKE === "1";

describe.skipIf(!UAT_GATE)("confirm route — replayed redirect (TEST-03)", () => {
  it("two GETs with same ResultKey redirect; log shows duplicate on second", async () => {
    const base = process.env.UAT_PREVIEW_URL!;
    const rk = process.env.UAT_RESULT_KEY!;
    const url = `${base}/api/checkout/confirm?ResultKey=${rk}&ResponseCode=0`;

    const first = await fetch(url, { redirect: "manual" });
    const second = await fetch(url, { redirect: "manual" });

    expect(first.status).toBe(307);
    expect(first.headers.get("location")).toMatch(/payment=success/);
    expect(second.status).toBe(307);
    expect(second.headers.get("location")).toMatch(/payment=success/);

    // Evidence: Vercel log on the second call MUST contain
    //   "[bpoint-confirm] duplicate ignored"
    // — capture via `vercel logs` or dashboard; record in 04-UAT-EVIDENCE.md.
  });
});
```

### Example 3: Webhook curl-replay (runbook-level)

```bash
# Source: curl + BPoint callback contract (MEDIUM — schema details opaque in public docs)
# Step 1: From a recent happy-path run, capture ResultKey from Vercel logs
#         with tag "[bpoint-confirm]" (shows up after retrieveTransaction).
RESULT_KEY="<uuid-from-log>"
PREVIEW_URL="https://aquarius-chatbot-git-<branch>-<team>.vercel.app"

# Step 2: First POST — should win SETNX + no-op (confirm route already ran fan-out).
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST "$PREVIEW_URL/api/webhooks/bpoint?ResultKey=$RESULT_KEY"
# Expected: 200

# Step 3: Second POST — SETNX collision, logs "[bpoint-webhook] duplicate ignored".
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST "$PREVIEW_URL/api/webhooks/bpoint?ResultKey=$RESULT_KEY"
# Expected: 200

# Step 4: Tail Vercel logs and grep:
vercel logs "$PREVIEW_URL" --follow | grep "bpoint-webhook"
# Expected: exactly one fan-out log line per bpointTxnNumber (the first or
# confirm-route, whichever won); second call logs "duplicate ignored".

# Evidence: paste both curl outputs + the two log lines into 04-UAT-EVIDENCE.md.
```

### Example 4: `vitest.config.mts` UAT exclusion

```typescript
// Source: https://vitest.dev/config/ (HIGH — official)
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

const runUat = process.env.UAT_SMOKE === "1";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "node",
    environmentMatchGlobs: [
      ["tests/**/*.test.tsx", "jsdom"],
      ["tests/payment-card.test.tsx", "jsdom"],
    ],
    setupFiles: ["./tests/setup.ts"],
    globals: false,
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: runUat
      ? ["node_modules/**", "dist/**"]
      : ["node_modules/**", "dist/**", "tests/uat/**"],
  },
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate UAT host (`bpoint.uat.linkly.com.au`) | Prod host + `IsTestTxn=true` per-call | Phase 1 (commit d2faa18, 2026-04-23) | UAT for this merchant can only be run against `https://www.bpoint.com.au`. Any doc/runbook mentioning the Linkly UAT subdomain is stale. |
| Stripe as payment provider | BPoint | Phase 3 (commit ~2026-04-24) | Rollback target is "earlier BPoint commit", not "back to Stripe." Runbook rollback section must reflect this. |
| `stripe-session:{id}` Redis namespace | `bpoint-txn:{TxnNumber}` | Phase 2/3 | UAT replay assertions hit the new namespace; any leftover `stripe-session:*` queries are dead. |
| Per-route dedup (confirm or webhook) | Shared namespace SETNX (both routes, `bpoint-txn:{TxnNumber}`) | Phase 3 | TEST-03 replay/retry tests **must** exercise the cross-route contract, not per-route. |

**Deprecated/outdated:**
- `.env.example` comment about `sandbox` hostname: `BPOINT_ENV=sandbox` in the file is inconsistent with the Phase 1 decision (`BPOINT_ENV=uat` for UAT, `BPOINT_ENV=prod` for production — "sandbox" is not a recognized value). **Opportunistic cleanup**: Phase 4 planner may add a task to align `.env.example` with `BPOINT_ENV=uat`.
- ROADMAP §"Validation & Go-Live" TEST-01 references `bpoint.uat.linkly.com.au` — Phase 1 resolved this to prod-host-with-`IsTestTxn`; planner must call out this correction in the Phase 4 plan intro so no one reverts.

## Open Questions

1. **BPoint UAT webhook retry cadence — observable?**
   - What we know: Public BPoint v2/v5 docs do not publish retry policy. Third-party surveys (Spreedly) do not either. BPoint v5 webhook page is a React SPA whose content is not crawlable.
   - What's unclear: Whether BPoint UAT retries at all on 5xx, and if so at what interval and how many times.
   - Recommendation: **Treat retry cadence as unobservable.** Plan TEST-03 webhook-retry via curl replay (CONTEXT Method B). Method A (natural retry by briefly disabling the preview) is best-effort — if retry arrives, capture it as bonus evidence; if not, curl replay is authoritative.

2. **BPoint v5 callback body schema**
   - What we know: Phase 3 deferred this as "log raw body during first prod deploy." `src/app/api/webhooks/bpoint/route.ts` intentionally ignores request body today — trust comes from `retrieveTransaction`, not the callback payload.
   - What's unclear: Whether BPoint v5 publishes the body schema anywhere accessible. `https://www.bpoint.com.au/developers/v5/api/webhooks` exists but returns no crawlable content.
   - Recommendation: **Fold the opportunistic raw-body logging into Phase 4 as a low-risk Wave (e.g., 04-03-PLAN.md)** — adds `const raw = await req.text()` logging with redaction + a 7-day window. Phase 4's validation captures the first real v5 callback body for free, closing a Phase 3 deferred item. This is in the CONTEXT "Claude's Discretion" zone.

3. **`.env.example` `BPOINT_ENV=sandbox` inconsistency**
   - What we know: Current `.env.example` uses `BPOINT_ENV=sandbox` (legacy pre-Phase-1 comment; code checks `!== "prod"` so semantically-equivalent to UAT).
   - What's unclear: Whether cleaning this up is in-scope for Phase 4 (validation) or belongs to a housekeeping task.
   - Recommendation: Planner may include a single-line `.env.example` fix as a low-risk opportunistic task under Claude's Discretion.

4. **Smokeball test-workspace routing**
   - What we know: CONTEXT external refs note "firm confirms whether test transcript emails route to a sandbox Smokeball or the production workspace."
   - What's unclear: If Zapier routes test-labelled transcripts to production Smokeball, the firm's test run pollutes real data.
   - Recommendation: Planner's runbook includes a pre-run step: operator confirms with firm which Smokeball workspace receives the test transcript email. If production workspace: use a distinctive client-name + mark-for-deletion convention in the intake (`clientName: "UAT TEST — delete after sign-off"`).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest `^2.1.9` (existing) |
| Config file | `vitest.config.mts` (existing; Phase 4 extends with UAT exclude) |
| Quick run command | `npx vitest run --reporter=dot` |
| Full suite command | `npx vitest run` |
| UAT-only command | `UAT_SMOKE=1 npx vitest run tests/uat` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| TEST-01 | Real UAT payment happy-path: iframe → confirm → fan-out → Smokeball | manual + UAT-smoke | `UAT_SMOKE=1 npx vitest run tests/uat/retrieve-smoke.test.ts` (retrieve-smoke only); full e2e is manual | ❌ Wave 0 creates `tests/uat/retrieve-smoke.test.ts` |
| TEST-01 | `retrieveTransaction` round-trip against live UAT returns documented shape | unit-style against live endpoint | `UAT_SMOKE=1 npx vitest run tests/uat/retrieve-smoke.test.ts` | ❌ Wave 0 creates |
| TEST-01 | Structured logs at `[bpoint-confirm]` include `bpointTxnNumber` | log-shape assertion | `UAT_SMOKE=1 npx vitest run tests/uat/log-shape.test.ts` | ❌ Wave 0 creates |
| TEST-02 | Smokeball invoice line matches `PRICING[urgency].lineItem` byte-for-byte | manual screenshot + transcription byte-compare | manual-only — firm screenshots; Claude byte-compares | — (manual) |
| TEST-02 | `MerchantReference` outbound equals `lineItem` string | log-grep | `grep "MerchantReference.*Initial Deposit" <vercel-log>` (manual) | — (manual log assertion) |
| TEST-03 | Declined card → failed redirect + "declined" bucket UI | manual + log assertion | manual iframe entry with expiry `9905`; log tail for `[bpoint-confirm] payment not approved` | — (manual) |
| TEST-03 | Expired AuthKey → failed redirect + "expired" bucket UI | manual 31-min wait | manual iframe, wait 31min, click Pay; verify `/?payment=failed&reason=expired` | — (manual) |
| TEST-03 | Replayed redirect → single fan-out | UAT-smoke | `UAT_SMOKE=1 npx vitest run tests/uat/confirm-replay.test.ts` | ❌ Wave 0 creates |
| TEST-03 | Webhook retry → single fan-out (shared SETNX) | UAT-smoke | `UAT_SMOKE=1 npx vitest run tests/uat/webhook-replay.test.ts` | ❌ Wave 0 creates |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=dot` (full mocked-unit suite; `tests/uat/` excluded by default)
- **Per wave merge:** `npx vitest run` (same — UAT tests remain excluded)
- **Phase gate (pre-`/gsd:verify-work`):** (1) Full mocked suite green; (2) `UAT_SMOKE=1 npx vitest run tests/uat` green **after** HPP activation; (3) Manual runbook checklist in `04-UAT-EVIDENCE.md` fully ticked; (4) Firm sign-off captured.

### Wave 0 Gaps
- [ ] `tests/uat/README.md` — how to run, env-var table, safety note, HPP-activation prereq
- [ ] `tests/uat/retrieve-smoke.test.ts` — covers TEST-01 retrieve round-trip + env-guard
- [ ] `tests/uat/confirm-replay.test.ts` — covers TEST-03 replayed redirect
- [ ] `tests/uat/webhook-replay.test.ts` — covers TEST-03 webhook retry
- [ ] `tests/uat/log-shape.test.ts` (optional) — asserts structured-log shape contract
- [ ] `vitest.config.mts` update — add conditional `exclude: ["tests/uat/**"]` guarded by `UAT_SMOKE !== "1"`
- [ ] `.planning/phases/04-validation/04-RUNBOOK.md` — manual steps: Vercel preview setup, HPP-activation confirmation, happy-path walkthrough, 4 failure-path walkthroughs, rollback procedure
- [ ] `.planning/phases/04-validation/04-UAT-EVIDENCE.md` (template) — per-SC rows with empty evidence slots
- [ ] `.planning/phases/04-validation/screenshots/` directory placeholder

*(No framework install needed — vitest is already wired.)*

## Sources

### Primary (HIGH confidence)
- `https://bpoint.com.au/developers/v3/partialViews/Sections/testmodetxn/description.html` — authoritative BPoint test-card list, amount-based + expiry-based + CVN-based response-code simulation rules
- `https://www.bpoint.com.au/backoffice/media/documents/Testing(Phone,Internet,DDCC).pdf` — BPoint official testing guide (PDF exists; content retrieval flagged by WebFetch but URL + presence confirmed)
- `https://vercel.com/docs/environment-variables` — preview env-vars, branch-scoped, deployment-scoped changes
- `https://vercel.com/docs/deployments/environments` — branch-alias URL stability contract
- `https://vitest.dev/config/` — `include` / `exclude` / `environmentMatchGlobs`
- `https://vitest.dev/api/test` — `describe.skipIf` / `it.skipIf` primitives
- `.planning/phases/01-foundation/01-VERIFICATION.md` (local) — prod-host-only facility decision (d2faa18), HPP-activation external blocker, 12-variant auth probe methodology
- `.planning/phases/02-confirmation-ui/02-VALIDATION.md` (local) — template for Phase 4's own VALIDATION.md
- `.planning/phases/03-webhook-cleanup/03-CONTEXT.md` (local) — trust-via-retrieveTransaction, shared `bpoint-txn:{TxnNumber}` SETNX namespace
- `src/lib/pricing.ts`, `src/lib/bpoint.ts`, `src/app/api/checkout/confirm/route.ts`, `src/app/api/webhooks/bpoint/route.ts`, `src/lib/payments/handleConfirmedPayment.ts` — code contracts under test
- `tests/fixtures/bpoint-responses.ts` — reusable response-shape fixtures
- `.planning/research/PITFALLS.md` (local) — Pitfalls 1, 4, 5, 8 are revalidated by Phase 4

### Secondary (MEDIUM confidence)
- `https://www.bpoint.com.au/developers/v5/reference/test-mode` — v5 test-mode landing (content opaque; rules confirmed via v3 docs + search summaries)
- `https://www.bpoint.com.au/developers/v2/` — Retrieve Transaction endpoint shape (response field list confirmed via WebFetch)
- `https://vitest.dev/guide/environment` — environment matrix
- `https://github.com/vitest-dev/vitest/discussions/1959` — skip-test-based-on-environment pattern confirmation

### Tertiary (LOW confidence — flagged for validation during execution)
- BPoint v5 webhook callback body schema — not publicly documented; plan captures raw body during first prod deploy (Phase 3 deferred idea, foldable into Phase 4 Wave 3)
- BPoint UAT retry cadence — no authoritative source; treated as unobservable; TEST-03 method B (curl replay) is the primary induction

## Metadata

**Confidence breakdown:**
- Standard stack (BPoint test conventions, vitest, Vercel preview): **HIGH** — all three have authoritative primary sources
- Architecture (two-layer gate, shared SETNX dedup, branch-alias URL): **HIGH** — codebase already implements the patterns; docs confirm Vercel stability
- Pitfalls: **HIGH** for env-var, URL-alias, amount-convention; **MEDIUM** for webhook retry (by necessity — the gap is real and acknowledged)
- BPoint callback body schema: **LOW** — opaque; addressed by opportunistic raw-body logging

**Research date:** 2026-04-24
**Valid until:** 2026-05-24 (30 days — stable area; BPoint test-mode conventions have been consistent across v2/v3/v5)
