---
phase: 01-dispatch-foundation
plan: "01"
subsystem: test-infrastructure
tags: [vitest, libphonenumber-js, tdd, red-scaffold]
dependency_graph:
  requires: []
  provides: [vitest-runner, test-scaffold, red-tests]
  affects: [01-02-PLAN]
tech_stack:
  added: [vitest@4.1.5, libphonenumber-js@1.12.42]
  patterns: [vitest-node-env, vi.stubGlobal, vi.spyOn]
key_files:
  created:
    - .claude/worktrees/clicksend-sms/vitest.config.ts
    - .claude/worktrees/clicksend-sms/src/lib/sms/__tests__/dispatch.test.ts
  modified:
    - .claude/worktrees/clicksend-sms/package.json
    - .claude/worktrees/clicksend-sms/package-lock.json
    - .claude/worktrees/clicksend-sms/tsconfig.json
decisions:
  - "No @vitejs/plugin-react installed — node-environment tests don't need it; avoids unnecessary dependency for plan 01 scope"
  - "libphonenumber-js installed in dependencies (not devDependencies) — it will be imported by dispatch.ts at runtime in plan 02"
  - "vitest/globals registered in tsconfig.json types array — eliminates Cannot find name 'describe' TypeScript errors in test files"
metrics:
  duration: "2m"
  completed: "2026-04-27"
  tasks_completed: 3
  files_changed: 5
  commits: 3
---

# Phase 01 Plan 01: Vitest Test Infrastructure + RED Scaffold Summary

Installed Vitest 4.1.5 and libphonenumber-js 1.12.42 in the worktree, created vitest.config.ts with node environment and @/ alias, registered vitest/globals in tsconfig.json, and wrote 6 failing test stubs encoding every Phase 1 success criterion in RED state.

---

## What Was Built

### Vitest runner (Tasks 1-2)

- `vitest@4.1.5` installed as devDependency
- `libphonenumber-js@1.12.42` installed as dependency (needed at runtime by dispatch.ts)
- `npm run test` → `vitest run` and `npm run test:watch` → `vitest` scripts added to package.json
- `vitest.config.ts` created at worktree root with `environment: "node"`, `globals: true`, `unstubGlobals: true`, `clearMocks: true`, and `@/` alias to `./src`
- `tsconfig.json` updated to add `"types": ["vitest/globals"]` so `describe`, `it`, `expect`, `vi` typecheck without explicit imports

### Test scaffold (Task 3 — RED state)

File: `src/lib/sms/__tests__/dispatch.test.ts`

6 test cases, one per Phase 1 success criterion:

| # | Test name | Requirement |
|---|-----------|-------------|
| 1 | converts a spaced AU mobile to E.164 | SMS-03 |
| 2 | is idempotent on already-E.164 input | SMS-03 |
| 3 | skips landline numbers, never calls fetch, logs sms_skipped reason=landline, no raw digits | SMS-04 + OPS-03 |
| 4 | logs only masked phone — raw E.164 never appears in any console.info call | OPS-03 |
| 5 | warns and returns without throwing when CLICKSEND_* env vars are absent — no fetch call | OPS-01 / TEST-01 |
| 6 | contains firm name, upload link, contact phone digits; no Reply STOP, no promo words | COMP-01 + COMP-02 |

---

## RED State Confirmation

Running `npx vitest run src/lib/sms/__tests__/dispatch.test.ts` exits with code 1:

```
FAIL  src/lib/sms/__tests__/dispatch.test.ts
Error: Cannot find module '../dispatch' imported from ...dispatch.test.ts
```

This is the expected RED state. The test file correctly imports from `../dispatch` and `../copy` — both files do not exist yet and will be created in plan 02 to flip these tests green.

Failing module names:
- `../dispatch` (missing — plan 02 creates `src/lib/sms/dispatch.ts`)
- `../copy` (missing — plan 02 creates `src/lib/sms/copy.ts`)

---

## Commits

| Hash | Message |
|------|---------|
| 783e130 | chore(01-01): install vitest 4.x and libphonenumber-js test dependencies |
| 6199a3b | chore(01-01): add vitest.config.ts and register vitest/globals in tsconfig |
| e756af1 | test(01-01): add 6 failing test stubs for Phase 1 success criteria (RED) |

All commits are on branch `feat/clicksend-urgent-sms` in the worktree.

---

## Deviations from Plan

None — plan executed exactly as written.

The plan noted `@vitejs/plugin-react` might be needed (RESEARCH.md Standard Stack), but the task action explicitly said "Do NOT install @vitejs/plugin-react — node-environment tests do not need it for plan 01 scope." This was followed precisely.

---

## Notes for Plan 02

- `libphonenumber-js/min` import path (`import { parsePhoneNumber } from "libphonenumber-js/min"`) — the file `node_modules/libphonenumber-js/min/index.cjs` confirmed present; subpath should resolve under Next.js 16 bundler moduleResolution. If it fails, fall back to `import { parsePhoneNumber } from "libphonenumber-js"` (same API).
- Tests use `vi.spyOn(console, "warn")` to assert the warn message contains both `"CLICKSEND"` and `"missing"` (case-insensitive) — dispatch.ts warn message must include both strings.
- The masked phone assertion uses `/\+61\*+5678/` — `redact()` must produce at least one `*` between `+61` and the last 4 digits `5678`.

---

## Self-Check: PASSED

| Item | Status |
|------|--------|
| vitest.config.ts exists | FOUND |
| dispatch.test.ts exists | FOUND |
| 01-01-SUMMARY.md exists | FOUND |
| commit 783e130 exists | FOUND |
| commit 6199a3b exists | FOUND |
| commit e756af1 exists | FOUND |
