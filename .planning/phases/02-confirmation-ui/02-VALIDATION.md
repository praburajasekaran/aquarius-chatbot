---
phase: 2
slug: confirmation-ui
status: ready
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-24
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (installed by Plan 00 / Wave 0) |
| **Config file** | `vitest.config.ts` (created by Plan 00 Task 1) |
| **Quick run command** | `npx vitest run --reporter=dot` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | < 10s for unit tests; < 30s including React component tests |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=dot` (or task-scoped variant: `npx vitest run tests/<file>.test.ts --reporter=dot`)
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** < 30s per task verify, < 60s per wave verify

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 2-00-01 | 00 | 1 | (infra) | install | `npm test 2>&1 \| grep -E "vitest\|No test files found"` | ❌ W0 creates | ⬜ pending |
| 2-00-02 | 00 | 1 | (fixtures) | scaffold | `test -f tests/fixtures/bpoint-responses.ts && grep -c "BankResponseCode" tests/fixtures/bpoint-responses.ts` | ❌ W0 creates | ⬜ pending |
| 2-00-03 | 00 | 1 | CONF-01..05, UI-01, UI-02, UI-04 | RED scaffolds | `npm test 2>&1 \| grep -E "Tests\|FAIL"` | ❌ W0 creates | ⬜ pending |
| 2-00-04 | 00 | 1 | UI-03 (chat-widget URL signal) | RED scaffold | `test -f tests/chat-widget.test.tsx && grep -c "^  it(" tests/chat-widget.test.tsx` | ❌ W0 creates | ⬜ pending |
| 2-01-01 | 01 | 2 | CONF-02 | unit (mock fetch) | `npx vitest run tests/bpoint.test.ts --reporter=dot` | ✅ after W0 | ⬜ pending |
| 2-01-02 | 01 | 2 | UI-02 | unit | `npx vitest run tests/bucket-bank-code.test.ts --reporter=dot` | ✅ after W0 | ⬜ pending |
| 2-02-01 | 02 | 2 | CONF-04 | unit (mock kv/intake/upload-tokens/resend) | `npx vitest run tests/handle-confirmed-payment.test.ts --reporter=dot` | ✅ after W0 | ⬜ pending |
| 2-03-01 | 03 | 3 | CONF-01, CONF-02, CONF-03, CONF-04, CONF-05 | unit (mock retrieveTransaction/redis/handleConfirmedPayment) | `npx vitest run tests/confirm-route.test.ts --reporter=dot` | ✅ after W0 | ⬜ pending |
| 2-03-02 | 03 | 3 | CONF-01 (manual smoke) | manual http probe | manual-only — operator runs documented curls | — | ⬜ pending |
| 2-04-01 | 04 | 3 | UI-01, UI-02, UI-04 | unit (RTL) | `npx vitest run tests/payment-card.test.tsx --reporter=dot` | ✅ after W0 | ⬜ pending |
| 2-04-02 | 04 | 3 | UI-04 (chat-widget URL signal) | unit (RTL + window mocking) | `npx vitest run tests/chat-widget.test.tsx --reporter=dot` | ✅ after W0 | ⬜ pending |
| 2-04-03 | 04 | 3 | UI-03 (CSP) | static + manual browser devtools | `grep "frame-src https://www.bpoint.com.au" next.config.ts` (static); browser console for live CSP | ✅ static, manual live | ⬜ pending |
| 2-04-04 | 04 | 3 | UI-01..04 (manual UI sweep) | manual browser | manual-only — operator walks 4 failure URLs in dev | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] **Plan 00 Task 1** — Install vitest + RTL + jsdom + jest-dom; wire `npm test`; create `vitest.config.ts` + `tests/setup.ts`
- [x] **Plan 00 Task 2** — Shared BPoint fixtures (`tests/fixtures/bpoint-responses.ts`): approved/declined/invalid/expired
- [x] **Plan 00 Task 3** — RED test scaffolds:
  - `tests/bpoint.test.ts` (CONF-02)
  - `tests/bucket-bank-code.test.ts` (UI-02)
  - `tests/confirm-route.test.ts` (CONF-01, CONF-03, CONF-04, CONF-05)
  - `tests/handle-confirmed-payment.test.ts` (CONF-04)
  - `tests/payment-card.test.tsx` (UI-01, UI-04)
- [x] **Plan 00 Task 4** — RED scaffold for chat-widget URL-param signal (`tests/chat-widget.test.tsx`):
  - `?payment=success` calls `handlePaymentComplete`
  - `?payment=failed&reason=expired` sets `failureReason='expired'` on PaymentCard
  - `?payment=failed&reason=<unknown>` falls back to `'system'`
  - `window.history.replaceState` is called to clear the param
- [x] No watch-mode flags (`vitest run`, never bare `vitest`)

*All vitest invocations use `run --reporter=dot` for non-watch, low-noise output.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Confirm route 3xx behaviour against dev server | CONF-01 | Requires running Next dev server + real HTTP | Plan 03 Task 2 — four curl probes against `http://localhost:3000/api/checkout/confirm` |
| BPoint iframe loads in browser without CSP violations | UI-01, UI-03 | Requires real browser + devtools console inspection | Plan 04 Task 4 — open dev chat, inspect DOM iframe + Network + Console |
| Four failure-reason URLs render locked-decision copy | UI-02, UI-04 | End-to-end UI walkthrough across browser navigation | Plan 04 Task 4 — visit `?payment=failed&reason={declined,invalid,system,expired}` |
| Live BPoint payment end-to-end (sandbox) | CONF-02, CONF-03, UI-01 | BPoint HPP product activation pending (per 01-VERIFICATION.md); deferred to Phase 4 UAT | Phase 4 UAT plan |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (chat-widget URL-param test added per checker fix)
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter (`wave_0_complete` remains `false` until Plan 00 executes)

**Approval:** ready
