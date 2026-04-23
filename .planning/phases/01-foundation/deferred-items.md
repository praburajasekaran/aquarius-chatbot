# Deferred Items - Phase 01 Foundation

Items discovered during phase execution that are out of scope for the current task and deferred for later attention.

## Build (turbopack.root) configuration issue

- **Discovered in:** Plan 01-01 (Task 2 verify step)
- **Symptom:** `npm run build` fails with:
  > Next.js inferred your workspace root, but it may not be correct.
  > We couldn't find the Next.js package (next/package.json) from the project directory: .../worktrees/modest-hermann-dda08b/src/app
- **Root cause:** This is running inside a git worktree (`.claude/worktrees/modest-hermann-dda08b`). Turbopack's workspace-root inference walks up looking for a lockfile and picks a path outside the worktree, causing it to fail to resolve `next/package.json` relative to `src/app`.
- **Not caused by this plan:** Pre-existing — unrelated to the pricing extraction. `npx tsc --noEmit` is clean; `npm run lint` is clean.
- **Suggested fix (future):** Set `turbopack.root` in `next.config.*` to the absolute worktree root, e.g.
  ```ts
  turbopack: { root: __dirname }
  ```
  or configure via the worktree-aware path resolution.
- **Scope:** Affects `npm run build` only inside worktrees; dev server and type-checking are unaffected.
