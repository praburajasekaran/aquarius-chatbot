# Design: Consultative Chat UX + Voice Input

**Date:** 2026-04-16
**Status:** Approved

---

## Problem

Two UX issues reported after user testing:

1. **Quick-reply buttons feel restrictive.** Users expected a free-form conversation but were presented with only a few button options. The chatbot felt transactional rather than consultative.
2. **No voice input.** Users on mobile want to speak their answers rather than type.

---

## Goals

- Make the chatbot feel like a consultative intake — curious, exploratory, information-gathering — not a menu-driven flow.
- Suggestion chips are shortcuts, not the primary interaction. Free-form text is always the primary path.
- Add a mic button that transcribes speech into the text field for review before sending.

---

## Feature 1 — Consultative AI + Suggestion Chips

### Architecture change: `showOptions` becomes non-blocking

Currently `showOptions` has no `execute` function, so the AI stream halts and waits for `addToolOutput` before continuing. This forces users to click a button.

**Change:** Add an `execute` function to `showOptions` that auto-resolves immediately with `{ selected: "" }`. The AI never waits for a button click. The tool's only job is to pass suggested option strings to the client for rendering.

### Chip rendering moves to the input zone

**Remove** chips from the message thread (`MessageList`). No chips rendered next to or below AI bubbles.

**Add** a `suggestions` prop to `MessageInput`. When suggestions are present, a "Quick reply" chip row renders above the textarea inside the input bar area.

**Visual hierarchy (squint test):**
1. AI message bubble — reads first
2. Text input — primary action
3. Chip row — quiet shortcut strip, clearly subordinate

**Chip styling:** small (`font-size: 11px`), square-cornered (`border-radius: 6px`), muted grey border (`#e5e7eb`), grey text (`#6b7280`), grey background (`#f9fafb`). Labelled "Quick reply" with a thin vertical divider.

**Chip behaviour:**
- Clicking a chip calls `onSend(chipText)` — sends as a normal user message via `sendMessage(text)`
- Chips disappear immediately when the user focuses the textarea or any message is sent
- If no suggestions, the chip row does not render (zero height)

### Wiring in `ChatWidget`

`ChatWidget` extracts suggestions from the last assistant message: find the last message with role `assistant`, look for a part with `type === "tool-showOptions"`, and read `part.input.options` — regardless of state. Because `execute` auto-resolves immediately on the server, the part will already be `output-available` by the time the client renders; checking for `input-available` would miss it. Pass the options array as `suggestions` to `MessageInput`. Clear suggestions when any new user message is sent.

### System prompt update

Reframe the AI's persona and constrain `showOptions` usage:

- **Persona:** consultative intake, not transactional. Ask follow-up questions. Gather context. Show genuine curiosity about the client's situation.
- **`showOptions` usage rule:** use only when (a) the next step is a clear unambiguous action (book appointment, proceed to payment, call now for urgent matters), or (b) the question has a small fixed set of answers with no reasonable free-form alternative (e.g. "yes/no" urgency check). Do not use `showOptions` after every response.
- **Urgent matters:** if signals indicate urgency (court date imminent, custody at risk, serious charge), cut the gathering short and escalate quickly. Do not drag out the conversation.

### Updated `showOptions` tool description

> Display optional suggestion chips for the user. Use sparingly — only at clear action points (book, pay, escalate) or for yes/no questions. For open-ended information gathering, ask conversationally and let the user type freely.

---

## Feature 2 — Voice Input (Web Speech API)

### Mic button in `MessageInput`

Add a mic button between the textarea and the send button.

**States:**

| State | Icon | Style |
|---|---|---|
| Idle | `Mic` (Lucide) | Same style as send button, teal |
| Listening | `MicOff` or animated `Mic` | Red tint, subtle pulse animation |
| Unsupported | hidden | Button not rendered |

**Behaviour:**
- On click: call `SpeechRecognition.start()`
- Configuration: `interimResults: false`, `lang: 'en-AU'`, `continuous: false`
- On `onresult`: set textarea value to transcript (replacing any existing content), focus textarea
- On `onerror` or `onend`: return to idle state
- Clicking mic again while listening: stops recognition (`abort()`)
- After transcript fills the textarea, the user reviews it and hits send manually — no auto-send

**Graceful degradation:**
- Check `'SpeechRecognition' in window || 'webkitSpeechRecognition' in window` on mount
- If not supported, mic button is not rendered — layout unchanged
- Works in Chrome and Safari (covers the vast majority of mobile users)

**`MessageInput` prop change:** no new props needed — voice state is internal to the component.

---

## Files to change

| File | Change |
|---|---|
| `src/lib/tools/show-options.ts` | Add `execute` that auto-returns `{ selected: "" }` |
| `src/lib/system-prompt.ts` | Rewrite AI persona; update `showOptions` usage guidance |
| `src/components/chat/message-list.tsx` | Remove `tool-showOptions` rendering block; remove `onOptionSelect` prop |
| `src/components/chat/message-input.tsx` | Add `suggestions` prop + chip row; add mic button + Web Speech logic |
| `src/components/chat/chat-widget.tsx` | Extract suggestions from last assistant message; pass to `MessageInput`; remove `onOptionSelect` handler and `addToolOutput` call for `showOptions` |
| `src/types/index.ts` | Remove `onOptionSelect` from any shared types if applicable (props are currently defined inline in `message-list.tsx`) |

---

## Out of scope

- Server-side speech transcription (Whisper, Groq) — revisit if Web Speech API accuracy proves insufficient in production
- Streaming interim voice results into the textarea
- Multi-language voice support beyond `en-AU`
