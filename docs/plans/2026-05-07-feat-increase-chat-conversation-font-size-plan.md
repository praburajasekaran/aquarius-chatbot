---
title: Increase chat conversation font size
type: feat
date: 2026-05-07
---

# Increase chat conversation font size

The chat conversation bubbles render at `text-sm` (14px), which is below the project's own stated mobile minimum of 16px (see [globals.css:30](src/app/globals.css:30) — *"16px — mobile minimum per learnui.design guidelines"*) and inconsistent with the composer textarea, which already uses `text-base` to prevent iOS auto-zoom (see [message-input.tsx:183](src/components/chat/message-input.tsx:183)).

Bump bubble text to `text-base` (16px) so conversation copy matches the surrounding UI and is comfortably readable on mobile.

## Acceptance Criteria

- [x] Assistant message bubbles render at 16px (`text-base`) instead of 14px (`text-sm`)
- [x] User message bubbles render at 16px
- [x] Static welcome bubble renders at 16px
- [x] Markdown content inside assistant bubbles (paragraphs, lists, links, bold) inherits the new size
- [x] Line-height (`leading-relaxed`) preserved — no cramped wrapping
- [x] No layout regressions: `max-w-[80%]` bubbles still wrap cleanly inside the chat widget at mobile (320px) and desktop widths
- [x] Tool confirmation cards (Payment, Upload, Schedule, Urgent) — already `text-base` — remain visually consistent with bubbles

## Context

**File to change:** [src/components/chat/message-list.tsx](src/components/chat/message-list.tsx)

Two `text-sm leading-relaxed` occurrences on bubble containers:

- Line 139 — welcome bubble
- Line 185 — user/assistant message bubbles

Change `text-sm` → `text-base` on both. The `prose-chat` wrapper div (line 197) has no defined styles in `globals.css`, so markdown children inherit from the bubble container — no extra CSS needed.

**Out of scope:**
- `disclaimer-banner.tsx` (`text-sm` on the banner is intentional secondary chrome)
- `chat-widget.tsx` header subtitle ("Criminal Law Assistant") at `text-sm` — secondary metadata
- Composer chip buttons (`text-xs`) — UI affordance, not conversation content

## MVP

### src/components/chat/message-list.tsx

```tsx
// Line 139 — welcome bubble
className="max-w-[80%] rounded-2xl px-4 py-2.5 text-base leading-relaxed bg-gray-100 text-gray-800 rounded-bl-md"

// Line 185 — message bubbles
className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-base leading-relaxed ${
  isUser
    ? "bg-[#085a66] text-white rounded-br-md"
    : "bg-gray-100 text-gray-800 rounded-bl-md"
}`}
```

## Verification

- [x] `npm run dev`, open the chat widget, send a message, confirm visibly larger bubble copy
- [x] Test at 320px viewport — long messages still wrap inside the bubble, no overflow
- [x] Send a message that triggers markdown (bold, list) — formatted output is also 16px
- [x] `npm run lint` passes

## References

- [src/components/chat/message-list.tsx:139](src/components/chat/message-list.tsx:139) — welcome bubble
- [src/components/chat/message-list.tsx:185](src/components/chat/message-list.tsx:185) — message bubbles
- [src/app/globals.css:30](src/app/globals.css:30) — 16px mobile baseline rationale
- [src/components/chat/message-input.tsx:183](src/components/chat/message-input.tsx:183) — iOS auto-zoom precedent for `text-base`
