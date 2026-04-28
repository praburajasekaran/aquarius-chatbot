---
phase: 1
slug: dispatch-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-27
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.5 (not yet installed — Wave 0 installs) |
| **Config file** | `vitest.config.ts` at worktree root (Wave 0 creates) |
| **Quick run command** | `npx vitest run src/lib/sms/__tests__/dispatch.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~3 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/lib/sms/__tests__/dispatch.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~3 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 0 | TEST-01 | infra | `npx vitest run` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 1 | SMS-03 | unit | `npx vitest run src/lib/sms/__tests__/dispatch.test.ts` | ❌ W0 | ⬜ pending |
| 1-01-03 | 01 | 1 | SMS-04 | unit | `npx vitest run src/lib/sms/__tests__/dispatch.test.ts` | ❌ W0 | ⬜ pending |
| 1-01-04 | 01 | 1 | OPS-03 | unit | `npx vitest run src/lib/sms/__tests__/dispatch.test.ts` | ❌ W0 | ⬜ pending |
| 1-01-05 | 01 | 1 | SMS-02 + TEST-01 | unit | `npx vitest run src/lib/sms/__tests__/dispatch.test.ts` | ❌ W0 | ⬜ pending |
| 1-01-06 | 01 | 2 | COMP-01 + COMP-02 | unit (string assertion) | `npx vitest run src/lib/sms/__tests__/dispatch.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/sms/__tests__/dispatch.test.ts` — all 6 test stubs (absent-env, landline, E.164, idempotent, masking, copy constants)
- [ ] `vitest.config.ts` — at worktree root; `environment: "node"`, `globals: true`, `@/` alias
- [ ] `package.json` — add `"test": "vitest run"` and `"test:watch": "vitest"` scripts; add `vitest` devDependency
- [ ] `tsconfig.json` — add `"vitest/globals"` to `compilerOptions.types`
- [ ] Install: `npm install -D vitest && npm install libphonenumber-js` in worktree

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SMS arrives on real AU mobile within 30s | SMS-01 (Phase 3) | Requires live CLICKSEND_* credentials and real device | Set env vars, trigger `sendSms("+61XXXXXXXXX", copy)` manually in a Node REPL or test script |
| Alpha-tag displayed as "AquariusLaw" on device | OPS-02 | Carrier rendering varies; cannot mock | Send test SMS with registered CLICKSEND_SENDER_ID and check handset |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
