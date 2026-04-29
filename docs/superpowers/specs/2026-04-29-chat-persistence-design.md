# Chat Persistence + End Chat + Client Transcript

**Status:** Draft for review
**Date:** 2026-04-29
**Owner:** @praburajasekaran

## Problem

Today the chat widget loses everything on page navigation or browser close. `ChatWidget` mints a fresh `sessionId` on every mount ([chat-widget.tsx:87](../../../src/components/chat/chat-widget.tsx)), `useChat` starts with an empty in-memory message list, and the host page's iframe reload (or a tab close) leaves the visitor with a blank greeting and orphans any intake metadata already written to Redis under the previous `sessionId` (1h TTL).

Three concrete consequences:

1. A visitor who navigates from `/about` to `/contact` on the host site loses their entire conversation mid-intake.
2. A visitor who closes the tab and returns 30 minutes later starts over — even though their intake fields, payment status, and uploads still exist in Redis under a `sessionId` they no longer hold.
3. The client receives a payment receipt with no record of what they discussed; only the firm currently gets the chat transcript on payment success.

## Goals

1. **Persist the chat across page navigation and browser close** for a 6-hour window, so visitors resume mid-intake naturally.
2. **Give visitors a visible safety control** to clear their chat — discoverable, single-purpose, behind a confirmation.
3. **Send the post-payment transcript to the client** in addition to the firm, in the existing receipt email (no second email).

## Non-goals

- Cross-device resume (a visitor on phone cannot pick up a chat started on desktop).
- Indefinite history sidebar / multi-conversation surface.
- Auto-reset on payment success or appointment booking — the chat stays open so visitors can ask follow-ups.
- Per-message delete or partial redaction.
- Idle auto-timeout that pops the End Chat dialog after inactivity.
- Server-side message archiving beyond the existing `transcript:${sessionId}` Redis key.

## Decisions

- **Retention window:** 6 hours, sliding (refreshed on every chat turn).
- **Storage location:** browser `localStorage` (key `aquarius_chat_v1`). Server-side `SessionData` already keyed by `sessionId` in Redis; `SESSION_TTL` is bumped from 1h → 6h to match.
- **Reset triggers:** TTL expiry (passive, on mount) and the manual End Chat button. Payment success and appointment booking do **not** reset.
- **End Chat label:** single button labelled "End chat" (not "Start new chat"). Frames the action as safety/closure, matches stated motivation, and avoids redundancy — the empty welcome state is itself the implicit start of a new chat.
- **Transcript-to-client:** appended to the existing `PaymentReceipt` email rendered by `handleIntakePaid`. Single email, two payloads (receipt + transcript). No new email send.

## Architecture

Three layers:

```
┌─────────────────────────────────────────────────────────┐
│ ChatWidget                                              │
│  ├── chat-persistence.ts  (load / save / endChat)       │
│  ├── useChat({ initialMessages })                       │
│  └── EndChatButton + EndChatDialog                      │
└─────────────────────────────────────────────────────────┘
              │ DELETE /api/chat/session
              ▼
┌─────────────────────────────────────────────────────────┐
│ /api/chat/session  (new, DELETE only)                   │
│  └── deleteSession(sessionId)                           │
└─────────────────────────────────────────────────────────┘

(unchanged)
┌─────────────────────────────────────────────────────────┐
│ /api/chat                                               │
│  └── persists transcript:${sessionId} on every turn     │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│ handleIntakePaid                                        │
│  ├── reads transcript:${sessionId}                      │
│  ├── PaymentReceipt({ ..., transcript })  → client      │
│  └── sendTranscriptEmail({ ..., transcript }) → firm    │
└─────────────────────────────────────────────────────────┘
```

### `chat-persistence.ts` (new module)

Pure browser module owning all `localStorage` access. The widget never touches `localStorage` directly.

```ts
// src/lib/chat-persistence.ts
const KEY = "aquarius_chat_v1";
const TTL_MS = 6 * 60 * 60 * 1000;
const SCHEMA = 1;

type Stored = {
  schemaVersion: 1;
  sessionId: string;
  messages: ChatMessage[];
  expiresAt: number;
};

export function loadChat(): { sessionId: string; initialMessages: ChatMessage[] } {
  // Try parse → validate schema + expiry → return restored or fresh.
  // Mints a fresh sessionId on miss/expiry/parse-error.
}

export function saveChat(sessionId: string, messages: ChatMessage[]): void {
  // Best-effort write; silently no-ops if storage is unavailable.
}

export function clearChat(): void {
  // Remove KEY. Always safe to call.
}
```

Failure modes (storage disabled, quota exceeded, JSON parse failure) all fall through to "fresh session," matching the current behavior — no thrown errors leak into the widget.

### `ChatWidget` integration

- Replace `useState(generateSessionId)` ([chat-widget.tsx:87](../../../src/components/chat/chat-widget.tsx)) with `useState(() => loadChat())` storing the full `{ sessionId, initialMessages }` tuple. The `sessionId` is read off this state for every transport and tool call.
- Pass `initialMessages` into `useChat`.
- Add a `useEffect` watching `[messages, status]` that calls `saveChat(sessionId, messages)` only when `status === "ready"` (settled turn) and `messages.length > 0`.
- Add `endChatPromptOpen: boolean` state, the `EndChatButton`, and the `EndChatDialog` component.
- Add `endChat()` callback that:
  1. Calls `stop()` from `useChat` if `status === "streaming"`.
  2. Calls `clearChat()`.
  3. Best-effort `fetch("/api/chat/session", { method: "DELETE", body: JSON.stringify({ sessionId }) })` — `.catch(() => {})`, never blocks UI.
  4. `setMessages([])` to reset `useChat`.
  5. Replaces the widget's `{ sessionId, initialMessages }` state with `loadChat()` — which, since `localStorage` was just wiped, mints a fresh `sessionId` and returns empty messages.
  6. Closes the dialog.

### `DELETE /api/chat/session` (new route)

```ts
// src/app/api/chat/session/route.ts
export async function DELETE(req: Request) {
  const { sessionId } = await req.json();
  if (typeof sessionId !== "string") {
    return new Response("bad request", { status: 400 });
  }
  await deleteSession(sessionId);
  // Also wipe the transcript so post-end-chat payments cannot leak old chat content.
  await redis.del(`transcript:${sessionId}`);
  return new Response(null, { status: 204 });
}
```

Idempotent. Safe to call on already-deleted sessions.

### Server TTL bump

In [kv.ts:9](../../../src/lib/kv.ts):

```ts
const SESSION_TTL = 6 * 60 * 60; // 6h, was 3600 (1h)
```

`updateSession` already re-`set`s with `{ ex: SESSION_TTL }`, so the TTL slides on every server-side intake update — matching the client-side sliding `expiresAt`.

### Client transcript in receipt email

In [handle-paid.ts](../../../src/lib/intake/handle-paid.ts):

- Move the `redis.get<string>(\`transcript:${sessionId}\`)` fetch from line 161 up to **before** the receipt-email block (~line 130), so both emails can use it.
- Pass `transcript={storedTranscript ?? undefined}` into `PaymentReceipt(...)`.
- In [payment-receipt.tsx](../../../src/lib/email/payment-receipt.tsx), add an optional `transcript?: string` prop. When present and non-empty, render below the receipt body:

  ```
  <Section>
    <Heading>Conversation summary</Heading>
    <Text style={{ whiteSpace: "pre-wrap", fontFamily: "ui-monospace, monospace", fontSize: 13 }}>
      {transcript}
    </Text>
  </Section>
  ```

- When `transcript` is missing/empty (rare — transcript write is best-effort), the section silently doesn't render. The receipt email still sends.

The existing `assertNoResendTracking` guard on the receipt email automatically covers the transcript content.

## End Chat button UX

**Placement:** ghost icon button in the widget header row, immediately to the left of the existing close (X) button. Lucide `RotateCcw` icon, 18px, `text-slate-500 hover:text-slate-700`. Visible at all times when `messages.length > 0`; hidden on the empty welcome state.

**Affordances:**
- `aria-label="End chat"`
- `title="End chat"` for desktop tooltip
- Visible focus ring matching the close button

**Confirm dialog:** rendered inside the widget DOM (no portal — already isolated by the iframe).

```
┌─────────────────────────────┐
│  End this chat?             │
│                             │
│  Your conversation will be  │
│  cleared from this device.  │
│                             │
│  [Cancel]   [End chat]      │
└─────────────────────────────┘
```

- Backdrop dims the message list (`bg-black/30`).
- Primary `End chat` button — brand color, calls `endChat()`.
- Secondary `Cancel` — neutral.
- Esc key + backdrop click also dismiss.
- Focus trap while open; focus returns to End Chat button on close.
- One-shot confirm; no second confirmation, no undo toast.

## Lifecycle

### Load (widget mount)
1. Read `aquarius_chat_v1` from `localStorage`.
2. Parse + validate `schemaVersion === 1` and `expiresAt > Date.now()`.
3. On valid → return `{ sessionId, initialMessages: messages }` to `useChat`.
4. On invalid/missing/expired → wipe key, mint fresh `sessionId`, return empty messages.

### Save (after every settled turn)
- `useEffect` on `[messages, status]`. Writes only when `status === "ready"` and `messages.length > 0`.
- Refreshes `expiresAt = Date.now() + 6h` on every save (sliding window).

### Reset
- **TTL expiry:** passive, only checked at Load time. No active timers.
- **End Chat button → confirm → `endChat()`:** stops any in-flight stream, wipes `localStorage`, fires-and-forgets `DELETE /api/chat/session`, resets `useChat`.

### Payment success (no reset)
- Existing `handleIntakePaid` fan-out runs as before.
- New: `PaymentReceipt` email now includes the conversation summary.
- Chat stays open; visitor can ask follow-ups.

## Edge cases

- **`localStorage` blocked / private mode:** `loadChat` and `saveChat` silently no-op. Behavior degrades to current "fresh on every mount" — no error, no broken UI.
- **Mid-stream End Chat:** `useChat.stop()` cancels the stream, then state is wiped. The server-side stream may have already partially run; `transcript:${sessionId}` may have stale lines, but the subsequent `redis.del` on `DELETE /api/chat/session` clears it.
- **Schema bump:** `schemaVersion: 1` lets a future shape change wipe stale entries without a migration script.
- **Tool-result rehydration:** `useChat`'s `initialMessages` accepts the same `ChatMessage[]` shape we already produce, including tool parts (`tool-initiatePayment`, `tool-uploadDocuments`, `tool-scheduleAppointment`, `tool-showUrgentContact`). Their rendered `output-available` state is preserved across reloads — payment cards, upload widgets, and Calendly embeds re-render correctly because they read from `part.output`, not from streaming state.
- **Session TTL drift:** if server TTL expires before client (Redis eviction, manual `del`), the next chat turn from a "valid client, dead server" state will be received as a brand-new session by `kv.ts` — `updateSession` throws `"Session expired"`. Mitigation: bumping `SESSION_TTL` to 6h matches the client window. This is the only path where client and server can disagree.
- **`transcript:${sessionId}` is best-effort:** `chat/route.ts` already swallows write failures. If the receipt fires before the last turn's transcript write completes, the receipt may be missing the final exchange. Acceptable today; not worth blocking the email pipeline on.
- **Welcome chips on rehydrated chat:** `INITIAL_WELCOME_CHIPS` should only render when `messages.length === 0`. The existing logic in `extractSuggestions` handles this naturally — restored sessions skip the welcome chips.

## Out of scope (explicit non-changes)

- The Zapier/Smokeball integration is unchanged. The transcript-to-CRM path, if any, is a separate concern.
- The booking confirmation email path is unchanged. Visitors who book without paying still get the existing booking email; transcript-to-client only fires on payment success.
- The iframe parent page (`chat-widget-embed.tsx`) is unchanged. No `postMessage` plumbing is added — persistence is fully internal to the iframe.

## Files changed

- **New:** `src/lib/chat-persistence.ts`
- **New:** `src/app/api/chat/session/route.ts` (DELETE only)
- **New:** `src/components/chat/end-chat-button.tsx`
- **New:** `src/components/chat/end-chat-dialog.tsx`
- **Modified:** `src/components/chat/chat-widget.tsx` — load/save wiring, button + dialog integration
- **Modified:** `src/lib/kv.ts` — `SESSION_TTL` 1h → 6h
- **Modified:** `src/lib/intake/handle-paid.ts` — fetch transcript before receipt block, pass to `PaymentReceipt`
- **Modified:** `src/lib/email/payment-receipt.tsx` — accept and render optional `transcript` prop

## Verification

Manual:
1. Start a chat, send 2 messages, navigate to a different host page → reopen widget → conversation restored with same `sessionId` (verify in network tab `/api/chat` body).
2. Same as 1 but close the tab and reopen within 6h → conversation restored.
3. Wait past 6h (or shorten TTL locally) → fresh chat on reopen.
4. Click End Chat → confirm → conversation gone, fresh `sessionId` minted, server `session:` key deleted.
5. Click End Chat → cancel → nothing changes.
6. Complete a payment in the demo flow → check inbox: receipt email contains a "Conversation summary" section with the chat history.
7. Block `localStorage` (DevTools → Application → Storage → Block) → widget still works, just doesn't persist.

## Open questions

None at spec time.
