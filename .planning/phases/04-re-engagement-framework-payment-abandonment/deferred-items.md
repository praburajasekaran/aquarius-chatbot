# Deferred Items — Phase 4

Issues discovered during execution that are out of scope for this phase.

## src/lib/__tests__/sanitize-llm-text.test.ts — pre-existing failure (Plan 04-03 execution)

- **Test:** `Line one\n\n\n\n<|eos|>\n\n\nLine two` → expected `"Line one\n\n\n\nLine two"` (4 newlines)
- **Status:** Failing on the worktree base commit before any 04-03 changes.
- **Owner:** Out of scope for Phase 4 (sanitize-llm-text is in src/lib/, unrelated to email-reminders).
- **Recommendation:** File a follow-up for whoever owns the sanitizer; the regex likely collapses runs of `\n` differently after `<|eos|>` removal.

## src/app/demo/chat-widget-embed.tsx:54 — pre-existing eslint error

- **Rule:** `react-hooks/set-state-in-effect`
- **Status:** Failing on the worktree base before any 04-03 changes.
- **Owner:** Out of scope for Phase 4 (chat-widget-embed is unrelated to email-reminders).
- **Recommendation:** Refactor `useEffect` body to use `useState` initialiser instead of synchronous `setState`.
