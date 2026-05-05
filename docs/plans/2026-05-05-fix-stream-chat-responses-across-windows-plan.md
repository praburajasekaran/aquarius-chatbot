---
title: "fix: Stream chat responses across windows"
type: fix
date: 2026-05-05
---

# fix: Stream chat responses across windows

## Overview

When the visitor opens the chatbot in two browser windows/tabs of the same origin (sharing the same `sessionId` from `localStorage`), only the window that submitted the message sees the streamed assistant response. The other window stays frozen on its last-known state until reload. This plan delivers true cross-window streaming so both tabs render the same assistant reply token-by-token while it is being generated, and stay in sync afterwards.

## Problem Statement / Motivation

### What the user observes
1. Open chat in window A → start a conversation.
2. Open chat in window B (same browser, same origin). Window B initially shows the same history because [chat-persistence.ts](src/lib/chat-persistence.ts) hydrates from `localStorage`.
3. Send a message in window A. Window A streams the assistant reply normally.
4. Window B shows nothing — no streaming, and the reply does not appear even after window A finishes. It only appears in B after a hard reload.

### Why this happens (root cause)
The chat is built on three layers, none of which are tab-aware:

- **Stream binding is per-fetch.** [`src/app/api/chat/route.ts:133`](src/app/api/chat/route.ts:133) returns `result.toUIMessageStreamResponse()`. The stream is bound to the HTTP response that window A's `useChat` POST initiated. Window B has no fetch open against this stream and no mechanism to subscribe.
- **No server-side fan-out.** Redis is used in two narrow ways:
  - `chatLimiter` rate-limit counters ([`src/lib/rate-limit.ts`](src/lib/rate-limit.ts)).
  - `transcript:{sessionId}` snapshot written via `after()` for CRM/handoff ([`src/app/api/chat/route.ts:104-112`](src/app/api/chat/route.ts:104)).
  Neither pushes to other clients. There is no pub/sub channel for streamed tokens.
- **Client persistence is write-only across tabs.** [`saveChat`](src/lib/chat-persistence.ts:92) writes to `localStorage` on every render of [`chat-widget.tsx`](src/components/chat/chat-widget.tsx), but no component listens for the `storage` event, and `useChat`'s in-memory `messages` is the source of truth for rendering. So even after window A persists the final state, window B's React tree never re-reads it.

### Why it matters
- Visitors commonly leave a chat tab open and reopen the site in a new tab (mobile especially). They reasonably expect the conversation to be the same in both places.
- For a legal-intake chatbot, a "ghost" second tab can confuse the visitor about whether their question was even sent — risky for the booking funnel and for urgent-call escalation.
- The booking handoff (`tool-scheduleAppointment`, `tool-showUrgentContact`) creates a terminal state ([`chat-widget.tsx:47-72`](src/components/chat/chat-widget.tsx:47)). If window B never sees this, it could let the user retry an action that's already booked, double-firing Zapier/Smokeball.

## Proposed Solution

Two-tier sync, layered so the partial fix lands first and the full fix layers on top without rework.

### Tier 1 — Eventual consistency via `storage` events (small, fast win)
Listen to the browser `storage` event in [`chat-widget.tsx`](src/components/chat/chat-widget.tsx). When window A's `saveChat()` writes new messages, every other tab in the same origin gets a `storage` event with the new payload. Hydrate `useChat`'s `messages` from it (via `setMessages`) when the incoming sessionId matches and the message count is greater than the local one.

This does NOT give true streaming in window B — window B will see the assistant reply appear only when window A finishes (i.e., when `onFinish` triggers `saveChat`). But it eliminates the "frozen forever until reload" failure mode and is roughly 30 lines of code.

### Tier 2 — True streaming fan-out via resumable streams (the real fix)
Adopt AI SDK v6's resumable streams pattern, backed by the existing Upstash Redis. Mechanism:

- **Per-request stream id.** When window A POSTs `/api/chat`, generate `streamId = crypto.randomUUID()`. Wrap the model output in a `resumableStream(streamId, () => result.toUIMessageStreamResponse(...).body)` from the `resumable-stream` package. This package uses Redis pub/sub + a replay buffer so that any subsequent subscriber to the same streamId receives every chunk from the start.
- **Active-stream pointer in Redis.** Set `chat:active:{sessionId} = streamId` with a short TTL (e.g., 90s, longer than `maxDuration: 30`). Clear in the stream's finalizer.
- **Resume endpoint.** New `GET /api/chat/[sessionId]/stream` reads `chat:active:{sessionId}`; if a streamId is present, returns `streamContext.resumableStream(streamId)`; otherwise 204. Same SSE/UIMessageStream wire format as the POST response, so the client can pipe it through `useChat` unchanged.
- **Client-side resume trigger.** On mount and on focus, [`chat-widget.tsx`](src/components/chat/chat-widget.tsx) calls `useChat`'s `experimental_resume()` (AI SDK v6) which hits the resume endpoint. If a stream is in progress, window B starts receiving tokens mid-flight; if not, it's a no-op. Optionally, broadcast a `BroadcastChannel('chat-active')` ping from window A right after kicking off the POST so window B doesn't have to poll.

This reuses Upstash Redis (already in stack) and the AI SDK's native pattern — no new infra, no Pusher/Ably.

## Technical Considerations

### Architecture impacts
- **New dependency:** `resumable-stream` (~3KB, MIT, maintained by the Vercel AI team).
- **New route:** `src/app/api/chat/[sessionId]/stream/route.ts` (GET handler).
- **POST route refactor:** [`src/app/api/chat/route.ts`](src/app/api/chat/route.ts) wraps response body with `streamContext.resumableStream`. `maxDuration` may need to extend slightly (Redis hop adds ~5–20ms; not material).
- **New Redis keys:** `chat:active:{sessionId}` (string, TTL 90s), `chat:stream:{streamId}:*` (managed internally by `resumable-stream`).
- **Client widget:** add `experimental_resume`, `BroadcastChannel` listener, and a `storage` event fallback for browsers without BC.

### Performance implications
- Redis pub/sub adds one round-trip per token chunk. Upstash global is sub-10ms from Vercel; user-visible latency increase should be well under 50ms total per response.
- Replay buffer is per-stream and short-lived (cleared on finish or TTL). Memory cost: negligible.
- Rate limiter unchanged; only the response shape changes.

### Security considerations
- The resume endpoint must verify the requester owns the sessionId. sessionId is opaque (`s_<uuid>`, 122 bits — already hardened in [`chat-persistence.ts:21`](src/lib/chat-persistence.ts:21)) and never returned in any URL parameter, so possession of it is the auth signal. Reject mismatched/malformed ids with 404 to avoid enumeration.
- Stream content includes the assistant's reply; same sensitivity as the existing POST response. No new data classes.
- `storage` event leaks: only fires same-origin, so no cross-site exposure. Safe.
- Rate-limit the resume endpoint separately (low-cost, but a chatty client could rebroadcast).

### AI SDK v6 specifics (verify before coding)
- `useChat` in v6 exposes `experimental_resume()` and accepts a `chatId` option that scopes the resume target. Confirm against `node_modules/@ai-sdk/react/dist/...` per AGENTS.md before wiring.
- `result.toUIMessageStreamResponse()` returns a Response whose body is the UI message stream — `resumable-stream` accepts a `() => ReadableStream` factory.
- Confirm `resumable-stream` package supports the `waitUntil` API exposed by Next.js `after()`/Vercel runtime.

### Concurrent submissions (edge case)
If both windows submit at the same time, they'd each create a stream and clobber `chat:active:{sessionId}`. Two options:
- **Reject the second submit** with a 409 if `chat:active:{sessionId}` is set (simple, surfaces the conflict to the loser tab as a "another tab is responding" toast).
- **Allow both,** keyed by streamId — each tab consumes its own. More complex, conflicts with the booking-state terminal guard.
Recommend option 1 for v1.

## Acceptance Criteria

### Tier 1 (storage-event sync)
- [x] Open two tabs (A, B) on the same origin with the same chat session.
- [x] Submit a message in A. After A's stream finishes, B's message list updates to include the new user message and full assistant reply within ≤ 1s of A's completion, without reload. _Verified via synthetic `storage` event in preview._
- [x] If B has stale state (e.g., missed earlier exchanges), opening B causes it to hydrate from localStorage AND, separately, listen for storage events going forward.
- [x] No `storage`-event-driven update overwrites a tab that has more recent in-memory state (ignore older `messages.length`).
- [x] Concurrent-submit guard: BroadcastChannel `start` from a sister tab disables input and shows an inline notice; `end` re-enables. SessionId mismatches ignored. _Verified in preview._

### Tier 2 (true streaming fan-out)
- [ ] Submit in A. While A is mid-stream, open B (or focus an already-open B). B begins rendering the assistant reply from the beginning, streaming tokens that match A's view, and converges to the same final state.
- [ ] B opened mid-stream receives all chunks emitted before it subscribed (replay), not just chunks from the moment of subscribe.
- [ ] If no stream is active, calling resume in B is a no-op (no error, no fake "loading" state).
- [ ] Concurrent submission from B while A's stream is active returns 409 with an in-UI toast explaining "another tab is responding."
- [ ] Stream completion clears `chat:active:{sessionId}` within 1s of finish.
- [ ] Stream failure (model error, abort) is surfaced to BOTH tabs, not just A.

### Quality gates
- [ ] `npm run build` and `npm run lint` clean.
- [ ] Manual test matrix: same browser two tabs, two windows, one tab + one mobile-emulator tab.
- [ ] Existing tests in `src/lib/__tests__` still pass; add a unit test for the new sessionId-ownership check on the resume route.
- [ ] No regression in single-tab streaming latency (eyeball test; first-token time within ±50ms of baseline).
- [ ] No new Redis keys leak past TTL after a normal completion.

## Success Metrics

- Zero "ghost second tab" reports from QA / staging.
- p50 cross-tab token-arrival delta in window B ≤ 200ms behind window A on a normal Wi-Fi connection.
- No increase in Smokeball/Zapier double-fires from the booking flow (i.e., terminal-state guard still holds across tabs because Tier 1 sync propagates `tool-scheduleAppointment.output.booked = true`).

## Dependencies & Risks

- **Dependency:** `resumable-stream` package — needs vetting for license and maintenance status before adding.
- **Risk:** AI SDK v6 `experimental_resume` API surface may shift (it's experimental). Mitigation: pin the SDK version in `package.json`, write a thin wrapper `resumeChat()` so a future API change is one-file.
- **Risk:** Upstash Redis pub/sub on the free/dev tier has connection limits. Mitigation: each stream uses one publisher + N subscribers; for a chat with 1–3 concurrent tabs the load is trivial.
- **Risk:** Some browsers (older Safari, privacy modes) suppress `storage` events across windows. Mitigation: Tier 2 doesn't rely on storage events for correctness; Tier 1 degrades gracefully — single-tab still works.
- **Risk:** Terminal-state booking guard ([`chat-widget.tsx:47`](src/components/chat/chat-widget.tsx:47)) needs to be re-evaluated whenever messages are merged from another tab. Mitigation: run `isTerminalState` after any cross-tab `setMessages`.
- **Risk (security):** A misconfigured resume route could let an attacker who guesses a sessionId tap any active stream. Mitigation: require the sessionId to be 122-bit random (already enforced) AND ratelimit the resume route.

## Implementation Notes (for the coder, not yet code)

### Files to touch
- `src/app/api/chat/route.ts` — wrap response in resumable stream, set/clear `chat:active:{sessionId}`, return 409 if a stream is already active.
- `src/app/api/chat/[sessionId]/stream/route.ts` — **new** GET handler.
- `src/lib/resumable-stream-context.ts` — **new** module exporting a singleton `streamContext` (publisher/subscriber wired to `redis`).
- `src/components/chat/chat-widget.tsx` — wire `experimental_resume`, add `storage` and `BroadcastChannel` listeners, run `isTerminalState` after merges, surface 409 toast.
- `src/lib/chat-persistence.ts` — add `subscribeToStorage(handler)` helper; keep `saveChat` unchanged but ensure it's called consistently after every `messages` change so the storage event is reliable.
- `src/lib/kv.ts` — no change needed; `redis` client already exported.
- `package.json` — add `resumable-stream` dependency.

### Pseudo-shape (illustrative only — verify v6 APIs first)

```ts
// src/lib/resumable-stream-context.ts
import { createResumableStreamContext } from "resumable-stream";
import { after } from "next/server";
import { redis } from "@/lib/kv";

export const streamContext = createResumableStreamContext({
  waitUntil: (p) => after(() => p),
  publisher: redis,
  subscriber: redis,
});
```

```ts
// src/app/api/chat/[sessionId]/stream/route.ts
export async function GET(_req: Request, { params }: { params: { sessionId: string } }) {
  const { sessionId } = params;
  if (!/^s_[a-f0-9-]{20,}$/i.test(sessionId)) return new Response(null, { status: 404 });
  const streamId = await redis.get<string>(`chat:active:${sessionId}`);
  if (!streamId) return new Response(null, { status: 204 });
  const stream = await streamContext.resumableStream(streamId);
  return stream ? new Response(stream) : new Response(null, { status: 204 });
}
```

```ts
// chat-widget.tsx (sketch)
const { experimental_resume, setMessages, ... } = useChat({ id: sessionId, ... });
useEffect(() => { experimental_resume(); }, [sessionId]);
useEffect(() => {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== "aquarius_chat_v1" || !e.newValue) return;
    const next = JSON.parse(e.newValue);
    if (next.sessionId !== sessionId) return;
    if (next.messages.length > messagesRef.current.length) setMessages(next.messages);
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}, [sessionId, setMessages]);
```

## References & Research

### Internal references
- Chat API route (POST): [src/app/api/chat/route.ts](src/app/api/chat/route.ts)
- Session create endpoint: [src/app/api/chat/session/route.ts](src/app/api/chat/session/route.ts)
- Chat widget: [src/components/chat/chat-widget.tsx](src/components/chat/chat-widget.tsx)
- Client persistence: [src/lib/chat-persistence.ts](src/lib/chat-persistence.ts)
- Upstash Redis client: [src/lib/kv.ts](src/lib/kv.ts)
- Rate limiter: [src/lib/rate-limit.ts](src/lib/rate-limit.ts)
- Tools / message types: [src/lib/tools.ts](src/lib/tools.ts)
- AGENTS.md note: this is a pre-release Next.js — verify AI SDK v6 / Next docs in `node_modules/next/dist/docs/` before coding.

### External references (verify currency before coding — January 2026 cutoff)
- Vercel AI SDK v6 docs — `useChat`, `experimental_resume`, `toUIMessageStreamResponse`.
- `resumable-stream` package on npm.
- Upstash Redis pub/sub docs (Edge runtime compatibility).
- Web Storage API: `storage` event semantics (same-origin, fires only in OTHER tabs).
- `BroadcastChannel` API for cross-tab notifications.

### Related work
- Recent fix that landed an analogous "tab-state correctness" issue: [commit 1082b79](../../commit/1082b79) — drop orphan tool parts before LLM call. Same class of problem (state from a closed tab confusing the next request); the cross-tab streaming fix should be careful not to reintroduce orphan tool parts when merging from another tab.
