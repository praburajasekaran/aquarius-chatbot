---
phase: 2
slug: confirmation-ui
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-24
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | TBD — populated by gsd-planner from RESEARCH.md Validation Architecture |
| **Config file** | TBD |
| **Quick run command** | TBD |
| **Full suite command** | TBD |
| **Estimated runtime** | TBD |

---

## Sampling Rate

- **After every task commit:** Run `{quick run command}`
- **After every plan wave:** Run `{full suite command}`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** TBD

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 2-01-01 | 01 | 1 | REQ-XX | unit | `{command}` | ✅ / ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Test files for new BPoint confirm route, fan-out extraction, and PaymentCard updates
- [ ] Shared fixtures (mock BPoint API responses, fake AuthKey/ResultKey)
- [ ] Test framework install if none detected

*Populated by planner from RESEARCH.md Validation Architecture.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| BPoint iframe renders + redirect behavior | UI-01, CONF-01 | Requires live BPoint sandbox | Load chat, complete payment in BPoint sandbox, observe redirect |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < TBD
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
