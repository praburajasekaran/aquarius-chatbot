---
phase: 3
slug: webhook-cleanup
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-24
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (mirrors confirm-route tests) |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run src/app/api/webhooks/bpoint` |
| **Full suite command** | `npm run test && npm run lint && npm run build` |
| **Estimated runtime** | ~45 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/app/api/webhooks/bpoint`
- **After every plan wave:** Run `npm run test && npm run lint`
- **Before `/gsd:verify-work`:** `npm run build` must succeed with zero Stripe imports
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 1 | WEBH-01..04 | unit (RED) | `npx vitest run tests/webhook-bpoint.test.ts --reporter=verbose` | ❌ W0 | ⬜ pending |
| 3-02-01 | 02 | 2 | WEBH-01 | unit | `npm test -- tests/bpoint.test.ts && npm run build` | ✅ | ⬜ pending |
| 3-02-02 | 02 | 2 | WEBH-01..04 | unit (GREEN) | `npx vitest run tests/webhook-bpoint.test.ts --reporter=verbose` | ✅ | ⬜ pending |
| 3-03-01 | 03 | 3 | CLEAN-02 | port | `npm run build && npm run lint && npm test` | ✅ | ⬜ pending |
| 3-04-01 | 04 | 4 | CLEAN-02 | delete+rename | `npm run build && npm run lint && npm test` | ✅ | ⬜ pending |
| 3-04-02 | 04 | 4 | CLEAN-03 | docs scrub | `test $(grep -c "STRIPE_" .env.example) -eq 0 && test $(grep -ciE "stripe" .planning/codebase/INTEGRATIONS.md) -eq 0` | ✅ | ⬜ pending |
| 3-04-03 | 04 | 4 | CLEAN-01 | uninstall+build | `npm run build && npm run lint && npm test && test $(grep -cE '"stripe"\|"@stripe/' package.json) -eq 0` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/webhook-bpoint.test.ts` — 9 RED test cases covering WEBH-01, WEBH-02, WEBH-03, WEBH-04 (incl. defensive `resultkey` casing probe)
- [ ] `tests/fixtures/bpoint-responses.ts` — shared sandbox fixtures for retrieveTransaction replies
- [ ] `vitest` already configured (Phase 2 confirm-route tests exist) — no install needed

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end BPoint webhook flow | WEBH-01 | Requires BPoint sandbox webhook delivery | Trigger a sandbox payment; confirm `/api/webhooks/bpoint` receives callback; verify email + Smokeball fan-out fires once even after BPoint retry |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
