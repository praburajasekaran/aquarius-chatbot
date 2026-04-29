# Bigger Chips for Mandatory Answer Choices

**Date:** 2026-04-29
**Status:** Brainstorm complete — ready for `/workflows:plan`

## What We're Building

Restore visually prominent, in-thread pill chips for **mandatory** answer choices (where the visitor must pick one to advance), while keeping the small composer-row chips for **optional** shortcuts.

Today every `showOptions` call renders as a small `text-xs` chip in a "Quick reply" row above the textarea (`src/components/chat/message-input.tsx:148-166`). Before commit `1ee59bc` ("refactor(chat): remove in-thread chip rendering from MessageList"), chips rendered in-thread under the assistant bubble as full-size pills (`px-4 min-h-[44px] rounded-full text-base font-medium`) with a 44px WCAG-AAA touch target and a "selected" highlight state. That treatment was right for mandatory moments — urgency selection, payment Yes/No — and is what the user wants back.

## Why This Approach

**Approach A — `mandatory` flag on `showOptions`.**

Add an optional `mandatory: boolean` to the tool's `inputSchema`. The client renderer branches on it:

- `mandatory: true` → big pill chips, rendered **in-thread** under the assistant bubble, 44px touch target, selected-state highlight.
- `mandatory: false | undefined` → existing small chips in the composer "Quick reply" row.

Chosen over splitting into two tools (B) because it's the smallest change that still gives the AI explicit control. Chosen over client heuristics (C) because pattern-matching `$` or "Yes/No" is brittle — the moment a mandatory question doesn't match, the UX silently degrades.

## Key Decisions

- **Differentiation lives in the tool input, not the client.** AI declares intent via `mandatory: true`; the renderer trusts it.
- **In-thread placement for mandatory chips.** Couples the choice to the question that asked it; matches pre-`1ee59bc` UX.
- **Composer-row stays for optional chips.** Welcome chips, "Ask another question" prompts, and other shortcuts remain low-visual-weight.
- **Restore selected-state feedback** for mandatory chips (filled chip after click) so the visitor sees what they picked, mirroring the original in-thread behaviour.
- **System prompt updated** to set `mandatory: true` at the existing mandatory call sites:
  - Urgency picker: `["Urgent — $1,320", "Non-urgent — $726"]` (`src/lib/system-prompt.ts:76`)
  - Payment confirm: `["Yes, please proceed", "No, I don't want to proceed"]` (`src/lib/system-prompt.ts:84`)
  - All other `showOptions` calls (welcome, "Ask another question", etc.) remain optional.

## Scope (YAGNI)

- No new tool. No new tool part type. Reuse `tool-showOptions`.
- No keyboard-trap or input-disable when chips are mandatory — visitor can still type if they really want to. The chips are the path, not a wall.
- No animation work. Match the previous static styles.

## Open Questions

- Should the textarea be **visually de-emphasised** (e.g. dimmer placeholder) while a mandatory chip group is unanswered, to push the visitor toward the chips? Default: no — keep textarea fully usable.
- After a mandatory chip is clicked and the AI responds, do the chips **persist as a record of what was picked** (selected-highlight state retained) or collapse away? Default: persist, matching pre-refactor behaviour.

## Files Likely Touched (informational, not a plan)

- `src/lib/tools/show-options.ts` — add `mandatory` to schema.
- `src/components/chat/message-list.tsx` — render mandatory chips in-thread.
- `src/components/chat/chat-widget.tsx` / `message-input.tsx` — only show non-mandatory chips in the composer row.
- `src/lib/system-prompt.ts` — flag the urgency and payment-confirm calls as `mandatory: true`.

## Next Step

Run `/workflows:plan` to produce the implementation plan.
