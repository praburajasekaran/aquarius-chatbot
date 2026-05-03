---
title: Sanitize orphaned tool parts to prevent AI_MissingToolResultsError
type: fix
date: 2026-05-03
---

# fix: Sanitize orphaned tool parts to prevent AI_MissingToolResultsError

## Overview

`/api/chat` recurringly throws `AI_MissingToolResultsError` from `convertToModelMessages`. The error fires whenever the persisted transcript posted to the server contains an assistant `tool-*` part in state `input-streaming` or `input-available` without a paired `output-available` / `output-error` result anywhere in the message history. AI SDK v6 strictly requires tool-call / tool-result pairing across the entire transcript, not just the last turn.

This is **not** a side effect of commit [5ec5f3f](../../) (`fix(chat): block LLM calls after booking flow completes`). 5ec5f3f's client-side terminal-state guard short-circuits one specific path — the post-booking re-narration loop — and never introduces orphan parts (its `setMessages` writes text-only assistant turns). The orphan bug is older and surfaces on every mid-flow tab-close path that 5ec5f3f does not cover. With the booking-loop noise silenced by 5ec5f3f, this latent error simply became visible.

The fix is a layered orphan sanitizer applied at hydration and at the server entry, plus an `onError` for visibility and a tightened `shouldAutoContinue`.

## Problem Statement / Motivation

Every `messages` mutation while `useChat` status is `ready` flushes the transcript verbatim to localStorage at [src/lib/chat-persistence.ts:83](../../src/lib/chat-persistence.ts), with TTL 6h. The validator [`isMessageLike`](../../src/lib/chat-persistence.ts) (lines 26–30) checks only `id: string` and `Array.isArray(parts)` — it never inspects part state. So whenever the user abandons mid-flow (closes the tab between a client tool rendering and the user clicking its UI), the persisted state preserves the tool part in `input-available` state with no result.

On return within the TTL:

1. **Hydration replay** ([chat-widget.tsx:204–214](../../src/components/chat/chat-widget.tsx)) fires `void sendMessage()` whenever `shouldAutoContinue(initialMessages)` is true. `shouldAutoContinue` only inspects the last message; orphans earlier in the transcript pass through.
2. **User types** → `sendMessage({ text })` posts the same orphan-bearing transcript.

Either path POSTs to `/api/chat`, [route.ts:97](../../src/app/api/chat/route.ts) calls `await convertToModelMessages(messages)` → `AI_MissingToolResultsError`. The error propagates through `streamText` → fetch error → `useChat` updates `status` to `error` — but there is **no `onError` handler** ([chat-widget.tsx:177–181](../../src/components/chat/chat-widget.tsx)), so the user sees a stuck "Typing..." spinner with no diagnostic.

Likely real-world triggers (in order of probability):

- User clicks a payment link, Stripe Checkout opens in a new tab, the user closes the chat tab without completing → `tool-initiatePayment` left as `input-available`.
- User starts the upload flow, the picker is open when they close the tab → `tool-uploadDocuments` orphaned.
- Calendly schedule card rendered, user navigates away → `tool-scheduleAppointment` orphaned.
- Network blip mid-stream leaves `tool-*` in `input-streaming` → never transitions.

## Proposed Solution

**Scope revised after reading SDK source.** AI SDK v6 ships a built-in option for exactly this case: `convertToModelMessages(messages, { ignoreIncompleteToolCalls: true })` filters orphan tool parts (`input-streaming` / `input-available`) before conversion ([node_modules/ai/dist/index.mjs:8318-8324](../../node_modules/ai/dist/index.mjs)). No custom sanitizer needed — the SDK handles it.

Minimal three-part fix:

1. **Pass `ignoreIncompleteToolCalls: true`** to `convertToModelMessages` in `/api/chat/route.ts`. This is the actual bug fix — one line.
2. **Add `onError` to `useChat`** in `chat-widget.tsx`. Independent improvement: today, any server error leaves a stuck "Typing…" spinner because there is no error handler. Logs the underlying error and resets state.
3. **Route integration test** confirming a payload with an orphan client tool no longer throws and produces a successful stream.

Rejected scope (deliberately):

- **Custom orphan sanitizer module**: redundant with the SDK built-in. The SDK's filter strategy is *deletion*, not error-result synthesis — for our abandoned-flow case, that's the right behavior (the user's next message simply won't reference the abandoned tool, and if the model wants to re-emit it, that's the natural retry path).
- **Hydration sanitizer in `chat-persistence.ts`**: orphans rendered on rehydrate are not broken — the user can still click them to resume, or send a new message and the server filters silently. Cleaning the visible transcript on hydrate is a UX concern outside this bug.
- **Tightening `shouldAutoContinue`**: with the SDK option in place, even an orphan-bearing transcript posts cleanly. The current "last-message-only" check is fine.
- **`prepareSendMessagesRequest` transformer**: duplicates the server filter. Two places to keep in sync, no benefit.

## Technical Considerations

### AI SDK v6 part-state contract

Per the v6 migration guide and [troubleshooting/tool-invocation-missing-result](https://ai-sdk.dev/docs/troubleshooting/tool-invocation-missing-result):

- Tool part states: `input-streaming` → `input-available` → `output-available` | `output-error`.
- `convertToModelMessages` emits a `tool-result` ModelMessage only for parts in `output-available` or `output-error`. Anything else throws.
- The contract applies to *every* tool part in the transcript, not just the last assistant turn.

The sanitizer's job: walk every assistant message, find tool parts whose state is `input-streaming` or `input-available`, and rewrite them to `output-error` while preserving `toolCallId`, `toolName`, and `input`.

### Single source of truth

To keep client and server in lockstep, extract the scrub into a tiny shared module: `src/lib/chat-orphan-sanitizer.ts`. Both `chat-persistence.ts` and `/api/chat/route.ts` import it. This avoids divergence — a real risk because the part-state names live in `@ai-sdk/react` types and could shift across SDK minors.

### Architecture impacts

- One new module, one new test file, edits to three existing files. No new dependencies, no schema migration.
- localStorage `SCHEMA_VERSION` does **not** need bumping: the sanitizer normalizes on read, so existing stored payloads keep working.

### Performance

Scrub is O(messages × parts). For typical transcripts (≤200 messages, ≤10 parts each) the work is negligible compared to the LLM call. No memoization needed.

### Security

A malicious user could craft a localStorage payload that survives the client scrub (e.g., by injecting a tool part with an unrecognized state string). The server scrub (layer 2) makes this safe — the server treats anything not in `{ "output-available", "output-error" }` as orphan.

### Existing 5ec5f3f terminal-state guard

The terminal-state shortcut in [chat-widget.tsx:246–260](../../src/components/chat/chat-widget.tsx) appends text-only messages and never POSTs. It is unaffected by the sanitizer. The fix must not regress this path: handleSend must still bypass the API after `isTerminalState(messages)` returns true.

### `errorText` content

Use a short, non-actionable phrase: `"session abandoned"`. The model sees this as the tool's "result". Avoid phrasings the model might interpret as "retry" — explicit testing required to confirm the model doesn't loop.

## Acceptance Criteria

- [ ] `/api/chat` route passes `ignoreIncompleteToolCalls: true` to `convertToModelMessages`.
- [ ] POST to `/api/chat` with a transcript containing an orphan `tool-initiatePayment` (state `input-available`) returns 200 and a streaming response — no `AI_MissingToolResultsError`.
- [ ] `useChat` `onError` handler logs the underlying error so server failures stop being silent.
- [ ] No regression: 5ec5f3f's terminal-state shortcut still bypasses the API when `isTerminalState(messages)` is true.
- [ ] Test coverage:
  - [ ] `src/app/api/chat/__tests__/route.test.ts` (new): POSTing a payload with `input-available` and `input-streaming` tool parts succeeds, returns a stream.

## Success Metrics

- Zero `AI_MissingToolResultsError` occurrences in production logs over the 7 days following deploy.
- Reduction in "stuck typing indicator" reports / repeated `/api/chat` 500s in Upstash logs.
- No regression in completion rate of the booking / payment flows.

## Dependencies & Risks

| Risk | Mitigation |
|---|---|
| AI SDK v6 part-state names drift across minors | Import types from `@ai-sdk/react` where possible; document the constants in `chat-orphan-sanitizer.ts`; pin `ai` and `@ai-sdk/react` in `package.json` (already pinned with `^` — consider tightening). |
| Model interprets synthetic `output-error` as "retry this tool" → loop | Use unambiguous `errorText: "session abandoned"`; add test that POSTs a sanitized transcript and asserts the model does not re-emit the same tool. |
| Stale clients post unsanitized payloads during rollout | Server scrub (layer 2) handles this. No coordinated deploy required. |
| Server scrub masks a genuine SDK or model bug | Log every scrub at WARN with `toolCallId` + `toolName` + `state`; sample to Upstash so we can see real frequency. |
| Sanitizer regresses 5ec5f3f's terminal flow | Regression test asserting `handleSend` bypasses the API when `isTerminalState(messages)` is true and the persisted reply matches `terminalReplyText`. |
| Tightened `shouldAutoContinue` breaks legitimate auto-resume | Test cases for: (a) last msg has resolved tool, no orphans → auto-resume fires; (b) last msg resolved, earlier orphan → auto-resume suppressed; (c) last msg unresolved → no fire (existing behavior). |

## Implementation Sketch

### `src/app/api/chat/route.ts`

```ts
messages: await convertToModelMessages(messages as UIMessage[], {
  ignoreIncompleteToolCalls: true,
}),
```

### `src/components/chat/chat-widget.tsx`

```ts
useChat<ChatMessage>({
  transport,
  sendAutomaticallyWhen: shouldAutoContinue,
  messages: initialMessages,
  onError: (err) => {
    console.error("[chat] stream error", err);
  },
});
```

### `src/app/api/chat/__tests__/route.test.ts` (new)

POST a payload containing an `input-available` `tool-initiatePayment` (and an `input-streaming` for completeness). Assert:
- Response is 200 with a streaming body.
- No `AI_MissingToolResultsError` is thrown.

Mock `streamText` so the test does not call out to OpenRouter.

## References & Research

### Internal references

- Route entry: [src/app/api/chat/route.ts:97](../../src/app/api/chat/route.ts) — `await convertToModelMessages(messages as UIMessage[])` is the throw site.
- Persistence: [src/lib/chat-persistence.ts:67–80](../../src/lib/chat-persistence.ts) — `loadChat` returns raw `parsed.messages` with no part-state validation.
- Persistence write: [src/lib/chat-persistence.ts:83–95](../../src/lib/chat-persistence.ts) — saves verbatim on every status==="ready" mutation.
- Hydration replay: [src/components/chat/chat-widget.tsx:204–214](../../src/components/chat/chat-widget.tsx) — `void sendMessage()` post-mount when `shouldAutoContinue(initialMessages)`.
- `shouldAutoContinue`: [src/components/chat/chat-widget.tsx:108–131](../../src/components/chat/chat-widget.tsx) — only inspects last message; lets earlier orphans through.
- 5ec5f3f terminal-state shortcut: [src/components/chat/chat-widget.tsx:246–260](../../src/components/chat/chat-widget.tsx) — text-only setMessages bypass; orthogonal to this fix.
- Tool registry: [src/lib/tools/index.ts](../../src/lib/tools/index.ts) — 4 client-resolved tools (`initiatePayment`, `uploadDocuments`, `scheduleAppointment`, `showUrgentContact`) are the orphan candidates.
- Existing test: [src/lib/__tests__/chat-persistence.test.ts](../../src/lib/__tests__/chat-persistence.test.ts) — covers schema/TTL only, no tool lifecycle. To be extended.
- Conventions: [AGENTS.md](../../AGENTS.md) ("This is NOT the Next.js you know" — read `node_modules/next/dist/docs/`), [CLAUDE.md](../../CLAUDE.md) (AI SDK v6, Zod inputSchema, 1h Upstash session TTL, `@/` alias).

### External references

- AI SDK v6 troubleshooting — Tool invocation missing result: https://ai-sdk.dev/docs/troubleshooting/tool-invocation-missing-result
- AI SDK Migration Guide 5→6 (tool part state machine): https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0
- AI SDK chatbot message persistence: https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence
- AI SDK transport reference (`prepareSendMessagesRequest`): https://ai-sdk.dev/docs/ai-sdk-ui/transport
- AI SDK ToolUIPart reference: https://ai-sdk.dev/docs/reference/ai-sdk-core/ui-message

### Related GitHub issues

- [vercel/ai#9968](https://github.com/vercel/ai/issues/9968) — `convertToModelMessages` rejects approval-responded parts; deletion of orphan causes re-emission loop, so synthesize `output-error` instead.
- [vercel/ai#10169](https://github.com/vercel/ai/issues/10169), [#10980](https://github.com/vercel/ai/issues/10980) — `needsApproval` flow drops `tool_result` blocks under v6.
- [vercel/ai#4936](https://github.com/vercel/ai/issues/4936) — sporadic missing tool results in stream.
- [vercel/ai#4165](https://github.com/vercel/ai/issues/4165) — Anthropic provider error: "tool_use ids without corresponding tool_result blocks".
- [vercel/ai discussions/4845](https://github.com/vercel/ai/discussions/4845) — `sendAutomaticallyWhen` × hydration semantics.

### Related commits / context

- Commit 5ec5f3f — `fix(chat): block LLM calls after booking flow completes` — orthogonal; surfaced this latent bug by removing the noisy re-narration that masked it.
- Commit 9dc3746 — `fix(chat): keep welcome bubble visible after first user message` — touches chat-widget, no overlap.
- Commit d2c7fc1 — `fix(prompt): stop DeepSeek drifting to Chinese after booking` — system-prompt only, no overlap.
