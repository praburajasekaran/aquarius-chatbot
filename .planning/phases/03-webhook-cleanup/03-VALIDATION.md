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
| 3-01-01 | 01 | 1 | WEBH-01, WEBH-02 | unit | `npx vitest run src/app/api/webhooks/bpoint/route.test.ts` | ❌ W0 | ⬜ pending |
| 3-01-02 | 01 | 1 | WEBH-03 | unit | `npx vitest run -t "idempotency"` | ❌ W0 | ⬜ pending |
| 3-01-03 | 01 | 1 | WEBH-04 | unit | `npx vitest run -t "retrieve verification"` | ❌ W0 | ⬜ pending |
| 3-02-01 | 02 | 1 | WEBH-02 | refactor | `npx vitest run src/lib/payments/handleConfirmedPayment.test.ts` | ❌ W0 | ⬜ pending |
| 3-03-01 | 03 | 2 | CLEAN-03 | port | `npx vitest run src/app/api/checkout/resume` | ✅ | ⬜ pending |
| 3-04-01 | 04 | 3 | CLEAN-01 | integration | `grep -r "stripe" package.json \| wc -l` → 0 | ✅ | ⬜ pending |
| 3-04-02 | 04 | 3 | CLEAN-02 | integration | `test ! -f src/lib/stripe.ts && test ! -f src/app/api/webhooks/stripe/route.ts` | ✅ | ⬜ pending |
| 3-04-03 | 04 | 3 | CLEAN-01 | build | `npm run build` exits 0 | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/app/api/webhooks/bpoint/route.test.ts` — stubs for WEBH-01, WEBH-02, WEBH-03, WEBH-04
- [ ] `src/lib/payments/handleConfirmedPayment.test.ts` — stubs for shared helper
- [ ] `vitest` already configured (confirm route tests exist) — no install needed

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
