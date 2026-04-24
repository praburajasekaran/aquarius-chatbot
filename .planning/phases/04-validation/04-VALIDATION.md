---
phase: 4
slug: validation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-24
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing) + manual runbook |
| **Config file** | `vitest.config.mts` (Wave 0 adds UAT exclude + include gate) |
| **Quick run command** | `npm test -- --run` (existing 49-test suite, UAT excluded) |
| **Full suite command** | `UAT_SMOKE=1 npm test -- --run` (includes `tests/uat/**`) |
| **Estimated runtime** | ~10s quick / ~90s full (live BPoint UAT calls + fan-out assertions) |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --run` (quick, excludes UAT)
- **After every plan wave:** Run `UAT_SMOKE=1 npm test -- --run` only if preview deploy + HPP activation are live; otherwise quick suite suffices
- **Before `/gsd:verify-work`:** Full UAT suite green + evidence bundle (`04-UAT-EVIDENCE.md`) rows all ✅ + firm Smokeball screenshot attached
- **Max feedback latency:** 90 seconds (UAT suite); 10 seconds (quick suite)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 0 | TEST-01,02,03 | config | `grep -E "tests/uat" vitest.config.mts` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 0 | TEST-01,02,03 | scaffold | `test -d tests/uat && test -f tests/uat/README.md` | ❌ W0 | ⬜ pending |
| 04-01-03 | 01 | 0 | TEST-01,02,03 | scaffold | `test -f .planning/phases/04-validation/04-RUNBOOK.md && test -f .planning/phases/04-validation/04-UAT-EVIDENCE.md` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 1 | TEST-01 | integration (live) | `UAT_SMOKE=1 npm test -- tests/uat/happy-path.test.ts --run` | ❌ W0 | ⬜ pending |
| 04-02-02 | 02 | 1 | TEST-01 | integration (live) | `UAT_SMOKE=1 npm test -- tests/uat/retrieve-transaction.test.ts --run` | ❌ W0 | ⬜ pending |
| 04-03-01 | 03 | 1 | TEST-03 | integration (live) | `UAT_SMOKE=1 npm test -- tests/uat/confirm-replay.test.ts --run` | ❌ W0 | ⬜ pending |
| 04-03-02 | 03 | 1 | TEST-03 | integration (live) | `UAT_SMOKE=1 npm test -- tests/uat/webhook-retry.test.ts --run` | ❌ W0 | ⬜ pending |
| 04-03-03 | 03 | 1 | TEST-03 | integration (live) | `UAT_SMOKE=1 npm test -- tests/uat/declined-card.test.ts --run` | ❌ W0 | ⬜ pending |
| 04-03-04 | 03 | 1 | TEST-03 | manual+log | Runbook §"Expired AuthKey" checklist complete + Vercel log screenshot in evidence | ❌ W0 | ⬜ pending |
| 04-04-01 | 04 | 2 | TEST-02 | manual | Smokeball screenshot attached + byte-compare assertion passes: `grep -F "$(node -e 'console.log(require(\"./src/lib/pricing\").PRICING.urgent.lineItem)')" .planning/phases/04-validation/04-UAT-EVIDENCE.md` | ❌ W0 | ⬜ pending |
| 04-05-01 | 05 | 2 | TEST-01,02,03 | evidence | `grep -E "TEST-01.*✅" .planning/phases/04-validation/04-UAT-EVIDENCE.md && grep -E "TEST-02.*✅" .planning/phases/04-validation/04-UAT-EVIDENCE.md && grep -E "TEST-03.*✅" .planning/phases/04-validation/04-UAT-EVIDENCE.md` | ❌ W0 | ⬜ pending |
| 04-05-02 | 05 | 2 | TEST-01,02,03 | sign-off | Firm acknowledgement in `04-UAT-EVIDENCE.md` footer (name, date, medium) | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Note: Task IDs above are indicative — planner may resplit plans while preserving the sampling shape (W0 scaffolds → W1 automated UAT scripts + manual failure paths → W2 reconciliation + evidence).*

---

## Wave 0 Requirements

- [ ] `vitest.config.mts` — add `exclude: ['tests/uat/**']` by default; include only when `UAT_SMOKE=1` (exclude-pattern gate)
- [ ] `tests/uat/README.md` — short "how to run" note explaining `UAT_SMOKE=1`, required env vars, and do-not-CI warning
- [ ] `tests/uat/setup.ts` — shared helpers: `loadPreviewEnv()`, `assertUatGate()` (throws if `UAT_SMOKE` unset), `redactAuthKey()` for log assertions
- [ ] `tests/uat/fixtures/test-pans.ts` — BPoint UAT magic-expiry/CVN table from RESEARCH.md; typed constants for approved / declined / invalid-CVN / expired (amounts stay at real `PRICING`)
- [ ] `.planning/phases/04-validation/04-RUNBOOK.md` — operator runbook template (sections for preview deploy, env wiring, per-scenario steps, evidence capture, rollback procedure)
- [ ] `.planning/phases/04-validation/04-UAT-EVIDENCE.md` — evidence bundle template (per-SC rows, screenshot slots, log snippet slots, firm sign-off footer)
- [ ] `.planning/phases/04-validation/screenshots/.gitkeep` — directory for inline screenshots referenced from evidence bundle
- [ ] `.env.example` — add `UAT_SMOKE=` comment + (opportunistic) correct stale `BPOINT_ENV=sandbox` → `BPOINT_ENV=uat` documentation

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Client enters card in BPoint iframe | TEST-01 | Live third-party hosted page — not reliably scriptable; Playwright is explicitly deferred | Runbook §"Happy path": open preview URL, trigger checkout, enter BPoint-UAT approved PAN `5123456789012346` exp `12/29` CVN `000`, submit. Capture iframe screenshot pre-submit + redirect URL + receipt email screenshot. |
| Smokeball line-item reconciliation | TEST-02 | Requires firm's Smokeball workspace login; no programmatic access in scope | Firm logs into Smokeball, finds the matter/invoice created by Zapier, screenshots line items, sends screenshot. Claude byte-compares text against `PRICING.urgent.lineItem` / `PRICING.nonUrgent.lineItem`. Binary pass/fail. |
| Expired AuthKey bucket UX | TEST-03 | Requires authentic 31-minute wall-clock TTL — no code patching allowed per CONTEXT.md | Runbook §"Expired AuthKey": create AuthKey, set 31-minute timer, leave iframe idle, click Pay after timer, capture "expired" bucket screenshot + "Start again" button render + Vercel log showing AuthKey expiry response. |
| Firm sign-off | TEST-01,02,03 | Legal/governance gate — must be a human act | Firm replies in email or Slack acknowledging all three SCs green after reviewing `04-UAT-EVIDENCE.md`. Reply quoted verbatim in evidence bundle footer with name + date + medium. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (manual-only tasks above are isolated within waves, bracketed by automated tasks)
- [ ] Wave 0 covers all MISSING references (8 scaffold items)
- [ ] No watch-mode flags (all commands use `--run`)
- [ ] Feedback latency < 90s (UAT full suite target)
- [ ] `nyquist_compliant: true` set in frontmatter (after planner fills in real task IDs + commands)

**Approval:** pending
