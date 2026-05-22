---
phase: 1
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-23
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | {vitest 1.x — confirm in Wave 0 if not installed} |
| **Config file** | {path or "none — Wave 0 installs"} |
| **Quick run command** | `npx vitest run --reporter=dot` |
| **Full suite command** | `npx vitest run && npx tsc --noEmit` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=dot`
- **After every plan wave:** Run `npx vitest run && npx tsc --noEmit`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | DATA-01 | unit | `npx vitest run src/lib/pricing.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Install vitest if not present: `npm i -D vitest @vitest/ui`
- [ ] `src/lib/pricing.test.ts` — PRICING constant shape + amount-in-cents assertions
- [ ] `src/lib/bpoint.test.ts` — stubs for BPoint client (auth header, IsTestTxn, integer cents)
- [ ] `vitest.config.ts` — basic config
- [ ] `tsconfig.json` — ensure test files excluded from build or properly typed

*If vitest already installed and configured, only add the missing test files.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live BPoint AuthKey creation returns UUID | SESS-01 | Requires BPoint UAT credentials and network | `curl -X POST http://localhost:3000/api/checkout -H 'Content-Type: application/json' -d '{"matter":"urgent",...}'` — verify response has `authKey` field as UUID |
| IsTestTxn flag respects production env | SESS-04 | Requires toggling BPOINT_ENV / NODE_ENV | Set `BPOINT_ENV=prod` and verify outgoing request body has `IsTestTxn: false`; flip to non-prod and verify `true` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
