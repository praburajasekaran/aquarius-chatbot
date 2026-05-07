---
title: Update chat welcome message copy
type: refactor
date: 2026-05-07
---

# Update chat welcome message copy

Replace the current welcome bubble text with a shorter, non-criminal-specific greeting and ensure the paragraph break renders.

## Current

> Welcome to Aquarius Lawyers. I'm here to help with your criminal law questions and guide you through booking a Legal Strategy Session. Please note: I provide general information only — not legal advice. How can I help you today?

## New

> Welcome to Aquarius Lawyers. I'm here to help with your legal questions and guide you through booking a Legal Strategy Session.
>
> How can I help you today?

Two changes from the old copy:
1. "criminal law questions" → "legal questions"
2. Drop the "general information only — not legal advice" sentence (already shown in the disclaimer banner above the bubble — see [chat-widget.tsx](src/components/chat/chat-widget.tsx) disclaimer area)
3. Insert a paragraph break before "How can I help you today?"

## Acceptance Criteria

- [x] Welcome bubble shows the new two-paragraph copy with a visible blank line between the two paragraphs
- [x] System prompt's quoted welcome string at [src/lib/system-prompt.ts:142](src/lib/system-prompt.ts:142) stays in sync (no separate edit needed — it interpolates `BRANDING.welcomeMessage`)
- [x] Aria label on the welcome bubble still announces the full message to screen readers
- [x] No regression: assistant does not repeat the greeting after the first turn (system-prompt rule at [system-prompt.ts:144](src/lib/system-prompt.ts:144))

## Implementation

### 1. Update copy in `src/lib/branding.ts`

Replace the `welcomeMessage` getter at [src/lib/branding.ts:12-14](src/lib/branding.ts:12) so it returns the new text with a `\n\n` between paragraphs:

```ts
// src/lib/branding.ts
get welcomeMessage() {
  return `Welcome to ${this.firmName}. I'm here to help with your legal questions and guide you through booking a Legal Strategy Session.\n\nHow can I help you today?`;
},
```

### 2. Render the paragraph break in `src/components/chat/message-list.tsx`

The bubble at [message-list.tsx:137-142](src/components/chat/message-list.tsx:137) renders the string in a plain `<div>`, so `\n\n` collapses to a single space. Add `whitespace-pre-line` to the bubble's className so newlines become visible breaks:

```tsx
// src/components/chat/message-list.tsx (~line 139)
<div
  aria-label={`Assistant: ${BRANDING.welcomeMessage}`}
  className="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed bg-gray-100 text-gray-800 rounded-bl-md whitespace-pre-line"
>
  {BRANDING.welcomeMessage}
</div>
```

`whitespace-pre-line` collapses runs of spaces but preserves `\n`, which gives the desired paragraph spacing without affecting wrapping.

## Out of scope (flag for follow-up)

These strings still reference "criminal law" — confirm whether they should also be generalised:

- `tagline` — `"Criminal Law Assistant"` shown under the firm name in the header ([branding.ts:3](src/lib/branding.ts:3), rendered at [chat-widget.tsx:558](src/components/chat/chat-widget.tsx:558))
- `pageDescription` — `"...your criminal law questions..."` ([branding.ts:10](src/lib/branding.ts:10))
- `welcomeShort` — `"...Ask me anything about criminal law."` ([branding.ts:16](src/lib/branding.ts:16))

The aria-label on the chat container also says "Criminal Law Assistant chat" ([chat-widget.tsx:548](src/components/chat/chat-widget.tsx:548)).

## Verification

- [x] `npm run dev`, open chat widget, confirm new copy renders with a blank line between the two paragraphs
- [x] `npm run lint` clean
- [x] Send a message; confirm assistant does not regreet

## References

- Welcome string: [src/lib/branding.ts:12](src/lib/branding.ts:12)
- Welcome bubble render: [src/components/chat/message-list.tsx:137](src/components/chat/message-list.tsx:137)
- System prompt embed: [src/lib/system-prompt.ts:142](src/lib/system-prompt.ts:142)
