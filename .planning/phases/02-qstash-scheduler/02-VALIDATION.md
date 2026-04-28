---
phase: 2
slug: qstash-scheduler
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-27
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.5 (already installed from Phase 1) |
| **Config file** | `vitest.config.ts` (exists at worktree root from Phase 1 Wave 0) |
| **Quick run command** | `npx vitest run src/lib/sms/__tests__/reminder.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/lib/sms/__tests__/reminder.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 2-01-01 | 01 | 0 | SCHED-01 | unit | `npx vitest run src/lib/sms/__tests__/reminder.test.ts` | ❌ W0 | ⬜ pending |
| 2-01-02 | 01 | 1 | SCHED-01 | unit | `npx vitest run src/lib/sms/__tests__/reminder.test.ts` | ❌ W0 | ⬜ pending |
| 2-01-03 | 01 | 1 | SCHED-04 | unit | `npx vitest run src/lib/sms/__tests__/reminder.test.ts` | ❌ W0 | ⬜ pending |
| 2-02-01 | 02 | 1 | SCHED-02 | manual-only | N/A | N/A | ⬜ pending |
| 2-02-02 | 02 | 1 | SCHED-03 | unit | `npx vitest run src/lib/sms/__tests__/reminder.test.ts` | ❌ W0 | ⬜ pending |
| 2-02-03 | 02 | 1 | SCHED-05 | unit | `npx vitest run src/lib/sms/__tests__/reminder.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/sms/__tests__/reminder.test.ts` — stubs for SCHED-01, SCHED-03, SCHED-04, SCHED-05 (new file)
- [ ] `npm install @upstash/qstash` — production dependency not yet in `package.json`

*Vitest config, test scripts, and `dispatch.test.ts` already exist from Phase 1 Wave 0.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| POST without valid QStash signature returns non-200 | SCHED-02 | `verifySignatureAppRouter` requires real `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY` — cannot be unit-tested without valid signing keys | In Upstash console, trigger delivery without signing; confirm endpoint returns 401/403 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
