---
title: Bigger chips for mandatory answer choices
type: feat
date: 2026-04-29
brainstorm: docs/brainstorms/2026-04-29-bigger-mandatory-chips-brainstorm.md
---

# feat: Bigger chips for mandatory answer choices

## Overview

Restore the prominent, in-thread pill chips for **mandatory** `showOptions` calls — the points in the conversation where the visitor must pick one of a fixed set to advance (urgency selection, payment Yes/No). Optional shortcut chips (welcome message, "Ask another question") keep the existing small "Quick reply" row above the textarea.

This is a deliberate, scoped revert of part of commit `1ee59bc` ("refactor(chat): remove in-thread chip rendering from MessageList"), gated by a new `mandatory` flag on the `showOptions` tool input. The auto-resolve / streaming-stop architecture introduced after that refactor is preserved as-is.

## Problem Statement / Motivation

After commit `1ee59bc`, every `showOptions` call renders as a small `text-xs px-2.5 py-1` chip in a "Quick reply" row above the composer ([src/components/chat/message-input.tsx:148-166](src/components/chat/message-input.tsx:148)). That treatment is fine for **optional** shortcuts where the visitor could equally well type a free-form reply. But it's wrong for **mandatory** moments where the answer set is closed and the visitor needs a clear, tappable choice — currently the urgency picker (`Urgent — $1,320` / `Non-urgent — $726`) and the payment confirm (`Yes, please proceed` / `No, I don't want to proceed`) both look like incidental quick-reply suggestions instead of the gating decisions they actually are.

Pre-`1ee59bc`, mandatory chips rendered in-thread under the assistant bubble as full-size pill buttons (`px-4 min-h-[44px] rounded-full text-base font-medium`), with three states: interactive (latest, unanswered), selected (filled teal after click), and historical (muted grey). The plan brings that treatment back — but only for mandatory chips.

## Proposed Solution

**Approach A from the brainstorm: add `mandatory: boolean` to `showOptions` input schema, branch the renderer.**

- The AI declares intent by passing `mandatory: true` for gating choices.
- `MessageList` renders mandatory chips in-thread as big pills under the assistant bubble.
- `ChatWidget` filters mandatory entries out of the composer-row suggestions so chips never appear in both places.
- Selected-state for mandatory chips is **derived** from the immediately-following user message text matching one of the options — no change to the auto-resolve tool or the streaming/auto-continue logic.
- System prompt updated at two call sites (Step 4 turn 1, Step 5) to set `mandatory: true`. All other `showOptions` calls remain optional by default.

## Technical Considerations

### Architecture impacts (none structural)

- `showOptions` keeps `execute: async () => ({ acknowledged: true })` — auto-resolves server-side. No client-resolved tool wiring, no `addToolOutput` for chips, no changes to `shouldAutoContinue` ([src/components/chat/chat-widget.tsx:44-58](src/components/chat/chat-widget.tsx:44)) or `stopAfterShowOptionsOnly` ([src/app/api/chat/route.ts:21-27](src/app/api/chat/route.ts:21)). The streaming halt logic doesn't care about the new flag.
- A mandatory chip click is a normal user message via `sendMessage({ text })` — same wiring as the existing composer chips, just routed through a new `MessageList` callback prop instead of `MessageInput`.

### Selection-state derivation

For each rendered mandatory `tool-showOptions` part, look at the **next user message** in the messages array (skip across any tool parts in the same assistant turn). If that user message's text matches one of `part.input.options` exactly, that option is the selected one. If no following user message exists, the group is unanswered.

This works because:
- Chip clicks send the chip text **verbatim** via `handleChipClick` ([src/components/chat/message-input.tsx:72-75](src/components/chat/message-input.tsx:72)) — no transformation, exact match guaranteed.
- A free-typed response that doesn't match any chip leaves the group with `selectedOption = null`. Once a newer assistant message arrives, the group becomes historical (muted, all disabled). This matches the pre-refactor behaviour.

### Performance

Negligible. One extra branch in the renderer, one O(n) lookup of the next user message per mandatory chip group. `n` is small (chat transcript).

### Accessibility

Mandatory chips restore the original WCAG 2.5.5 AAA-compliant `min-h-[44px]` touch target and the AAA-contrast (7.88:1) filled selected state ([pre-1ee59bc message-list.tsx:152-190](https://github.com/praburajasekaran/aquarius-chatbot/commit/1ee59bc^/src/components/chat/message-list.tsx#L152-L190)). The button group keeps `role="group"` and `aria-label="Quick reply options"`; selected chips use `aria-pressed`.

### Security / Privacy

Out of scope — purely UI.

## Acceptance Criteria

### Functional

- [x] `showOptions` accepts an optional `mandatory: boolean` input field; default behaviour (omitted/false) is unchanged.
- [x] When the AI calls `showOptions({ options, mandatory: true })`, the chips render **in-thread under the assistant bubble** as big pills (`px-4 min-h-[44px] rounded-full text-base font-medium`).
- [x] When the AI calls `showOptions({ options })` or `showOptions({ options, mandatory: false })`, the chips render in the existing composer "Quick reply" row (small chips, `text-xs px-2.5 py-1`).
- [x] Mandatory chips never appear in BOTH the in-thread group AND the composer row at the same time.
- [x] Mandatory chip click sends the chip text as a normal user message (same as composer-row chip click).
- [x] In-thread mandatory chips show three visual states:
  - Latest, unanswered → outlined teal, hover fills, interactive.
  - Selected (matched by next user message) → filled teal, white text, `aria-pressed="true"`, disabled.
  - Historical (older assistant turn) or unanswered+not latest → muted grey, disabled.
- [x] After a mandatory chip is clicked, the chip group remains visible as a historical record (does not collapse). The selected state persists.

### System prompt

- [x] Step 4 turn 1 (urgency picker) calls `showOptions` with `mandatory: true`.
- [x] Step 5 (payment Yes/No) calls `showOptions` with `mandatory: true`.
- [x] Welcome chips, fallback "Ask another question" chips, "Book a session / I have another question" chips, and any other call sites omit `mandatory` (or pass `false`).
- [x] The "## WHEN TO USE showOptions" section documents the `mandatory` flag and when to set it.

### Non-functional

- [x] WCAG 2.5.5 AAA touch target: 44×44px on mandatory chips.
- [x] Selected-state contrast ≥ 7:1 (filled `bg-[#085a66]` on white).
- [x] No hydration mismatch — mandatory chips render the same on server and client.
- [x] Optional chips retain the existing first-keystroke dismissal and per-message reset behaviour.
- [x] `npm run lint` passes.
- [x] `npm run build` passes (TypeScript type-checks the new `mandatory?: boolean` field).

### Manual QA flow

- [x] Send "hi" → welcome chips show **in composer** (small).
- [x] Click "I've been charged" → AI explores; any "Book a session / I have another question" chips show **in composer** (small, optional).
- [x] Provide name/email/phone → AI presents urgency picker. Chips render **in-thread**, large, under the assistant bubble. Composer chip row is empty.
- [x] Click "Urgent — $1,320" → that chip stays filled (selected state); the other becomes muted; both disabled. AI proceeds to Step 5.
- [x] AI shows "Yes, please proceed / No, I don't want to proceed" as **in-thread** big pills.
- [x] Click "Yes, please proceed" → AI calls `initiatePayment`. Both Step 4 and Step 5 chip groups are visible historically with their selected chips highlighted.
- [x] Free-type a response instead of clicking a mandatory chip (e.g., type "urgent please") → AI advances based on text. Mandatory chip group becomes historical with no chip selected.
- [x] Tab + Enter through a mandatory chip group → keyboard reaches each chip; Enter activates the focused chip.
- [x] Screen reader announces "Quick reply options" group + each option's label; selected state is announced via `aria-pressed`.

## Implementation Plan

### Step 1 — Extend `showOptions` schema

**File:** [src/lib/tools/show-options.ts](src/lib/tools/show-options.ts)

```ts
// src/lib/tools/show-options.ts
export const showOptions = tool({
  description:
    "Display optional suggestion chips for the visitor. Use SPARINGLY — only at clear action points (book a session, proceed to payment, urgent escalation) or for tightly scoped yes/no questions. For open-ended information gathering, ask conversationally and let the visitor type freely. Do not use after every response. Always provide 2–4 short, clear options when used. " +
    "Set `mandatory: true` ONLY for gating decisions where the visitor must pick one of the listed options to advance the flow (urgency selection, payment Yes/No). Mandatory chips render as large in-thread pills; default chips render as a compact suggestion row.",
  inputSchema: z.object({
    options: z
      .array(z.string())
      .min(2)
      .max(4)
      .describe("The chip labels to show, e.g. ['Yes, proceed', 'Ask another question']"),
    mandatory: z
      .boolean()
      .optional()
      .describe(
        "When true, chips render in-thread as large pill buttons (gating decision). When false/omitted, chips render as a small composer suggestion row (optional shortcut)."
      ),
  }),
  execute: async () => ({ acknowledged: true } as const),
});
```

**Notes:**
- Optional field — keeps backward compat with any in-flight call.
- Description lift gives the AI clear guidance on when to set it.

### Step 2 — Render mandatory chips in `MessageList`

**File:** [src/components/chat/message-list.tsx](src/components/chat/message-list.tsx)

Add a new prop and a new branch in the parts loop:

```tsx
// New prop on MessageListProps
onMandatoryOptionPick: (text: string) => void;

// Inside the parts loop, add this branch (before/after the existing tool branches):
if (
  part.type === "tool-showOptions" &&
  part.input?.mandatory === true &&
  (part.state === "input-available" || part.state === "output-available")
) {
  // Lookahead: find the next user message after this assistant turn.
  // Match its text against the chip options to determine selection state.
  const selectedOption = findNextUserMessageMatching(messages, msgIndex, part.input.options);
  const isLatest = msgIndex === lastMsgIndex;
  const isAnswered = selectedOption !== null;
  const canInteract = isLatest && !isAnswered;

  return (
    <div
      key={part.toolCallId}
      role="group"
      aria-label="Quick reply options"
      className="flex flex-wrap gap-2 pl-11"
    >
      {part.input.options.map((option: string) => {
        const isSelected = option === selectedOption;
        const stateClasses = canInteract
          ? "border-[#085a66] text-[#085a66] hover:bg-[#085a66] hover:text-white cursor-pointer"
          : isSelected
          ? "border-[#085a66] bg-[#085a66] text-white cursor-default"
          : "border-gray-300 text-gray-500 cursor-default";
        return (
          <button
            key={option}
            onClick={() => canInteract && onMandatoryOptionPick(option)}
            disabled={!canInteract}
            aria-pressed={isSelected || undefined}
            className={`px-4 min-h-[44px] rounded-full border text-base font-medium transition-colors ${stateClasses}`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
```

**Helper:**

```ts
// Search messages[msgIndex+1 .. end] for the first user message; if its
// trimmed text matches one of `options` exactly, return that option.
// Returns null when no user message has been sent yet, or when the user
// typed a free-form reply that didn't match any chip.
function findNextUserMessageMatching(
  messages: ChatMessage[],
  fromIndex: number,
  options: string[]
): string | null {
  for (let i = fromIndex + 1; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const text = m.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text.trim())
      .join(" ")
      .trim();
    return options.find((o) => o === text) ?? null;
  }
  return null;
}
```

**Notes:**
- `pl-11` aligns the chip group with the assistant bubble's left edge (8px avatar + 12px gap = ~44px).
- Three-state class logic is lifted verbatim from the pre-1ee59bc renderer.
- Optional `tool-showOptions` parts (no `mandatory` flag) fall through and render nothing here — they're handled by the composer row.

### Step 3 — Filter mandatory chips out of the composer suggestions

**File:** [src/components/chat/chat-widget.tsx](src/components/chat/chat-widget.tsx)

Update `extractSuggestions` to skip mandatory entries:

```ts
function extractSuggestions(messages: ChatMessage[]): string[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    for (let j = msg.parts.length - 1; j >= 0; j--) {
      const part = msg.parts[j];
      if (part.type === "tool-showOptions") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const input = part.input as any;
        // Mandatory chips are rendered in-thread by MessageList — keep
        // them OUT of the composer row so the visitor doesn't see two
        // copies of the same choice.
        if (input?.mandatory === true) return [];
        const options = input?.options;
        if (Array.isArray(options) && options.length > 0) {
          return (options as unknown[]).filter((o): o is string => typeof o === "string");
        }
      }
    }
    return [];
  }
  return [];
}
```

**Wire `onMandatoryOptionPick`:**

```tsx
// In ChatWidget, reuse the existing handleSend pipeline so the chip click
// behaves identically to a typed message (auto-dismisses composer chips,
// triggers AI response, etc.).
<MessageList
  ...
  onMandatoryOptionPick={handleSend}
/>
```

`handleSend` already calls `setDismissedForMessageId(suggestionsKey)` and `sendMessage({ text })` — no new logic needed.

### Step 4 — Update system prompt

**File:** [src/lib/system-prompt.ts](src/lib/system-prompt.ts)

Two surgical edits:

1. In the "## WHEN TO USE showOptions" section, after line 35, insert a paragraph documenting the `mandatory` flag:

```
### MANDATORY vs OPTIONAL

Pass `mandatory: true` ONLY when the visitor's choice gates the next step and there is no acceptable free-form alternative. Use it for:
- Step 4 urgency picker: ["Urgent — $1,320", "Non-urgent — $726"]
- Step 5 payment confirm: ["Yes, please proceed", "No, I don't want to proceed"]

Leave `mandatory` omitted (default optional) for everything else: welcome chips, "Ask another question" prompts, "Book a session / I have another question", fallback chips. Optional chips render as a compact suggestion row alongside the composer; the visitor can ignore them and type freely.
```

2. Update the two existing call-site references in CONVERSATION FLOW (lines 76 and 84) to mention the `mandatory: true` flag:

```
- Turn 1 (this turn): briefly explain the two options, then call ONLY showOptions: { options: ["Urgent — $1,320", "Non-urgent — $726"], mandatory: true }. Do not call selectUrgency yet. Wait for the visitor to pick.
```

```
  2. Call showOptions with { options: ["Yes, please proceed", "No, I don't want to proceed"], mandatory: true }
```

Leave all other `showOptions` references as-is (they default to optional).

### Step 5 — Verification

1. `npm run lint` — pass.
2. `npm run build` — TypeScript checks the new `mandatory?: boolean` field flows through the AI SDK part type without `any` casts where avoidable.
3. `npm run dev` and run the full Manual QA flow above end-to-end.
4. Verify the urgency picker and payment confirm now render as big in-thread pills, with the composer row empty during those turns.

## Success Metrics

- Visual: mandatory chips are unmistakably the primary action at urgency-pick and payment-confirm moments. Internal review confirms parity with the pre-1ee59bc visual treatment.
- Behavioural: no regression in optional chip flows (welcome chips, "Ask another question", etc.) — verified via Manual QA.
- Telemetry: no spike in "free-typed urgency" responses (i.e., visitors typing "urgent" instead of clicking) — implies chips are findable. (Soft signal, not a hard gate.)

## Dependencies & Risks

### Dependencies

- AI SDK v6 (`ai`, `@ai-sdk/react`) — `tool-showOptions` part `input` already carries arbitrary tool input; no SDK change required.
- No new packages.

### Risks

- **AI forgets to set `mandatory: true`** at urgency or payment-confirm. Mitigation: explicit prompt examples in Step 4 and Step 5; the inline tool description also nudges. Detection: Manual QA covers both call sites. If observed in production, tighten the prompt or add a server-side "promote-to-mandatory" override for those specific option sets.
- **Visitor types a free-form response** that happens to match a chip exactly. The selection-by-text-match would mark the matched chip as selected. This is fine — the visitor's intent matches the chip; the highlight is accurate.
- **Visitor types a response that partially matches** (e.g., "urgent" vs "Urgent — $1,320"). No match → group becomes historical with no chip highlighted. Acceptable; consistent with "free-form responses are honoured".
- **Multiple mandatory chip groups in the same assistant turn.** Each gets its own `<button group>` and its own next-user-message lookup (which would resolve to the same user message for both, but that's only a real ambiguity if both groups share an option label — which the AI shouldn't be doing). Edge case, documented but not specially handled.

## Files Touched

| File | Change |
|------|--------|
| [src/lib/tools/show-options.ts](src/lib/tools/show-options.ts) | Add `mandatory?: boolean` to `inputSchema`; expand `description`. |
| [src/components/chat/message-list.tsx](src/components/chat/message-list.tsx) | Render mandatory `tool-showOptions` in-thread; add `onMandatoryOptionPick` prop and `findNextUserMessageMatching` helper. |
| [src/components/chat/chat-widget.tsx](src/components/chat/chat-widget.tsx) | Skip mandatory parts in `extractSuggestions`; pass `handleSend` as `onMandatoryOptionPick` to `MessageList`. |
| [src/lib/system-prompt.ts](src/lib/system-prompt.ts) | Document `mandatory` flag; flag Step 4 turn 1 and Step 5 call sites. |

No new files. No deletions.

## References & Research

### Internal references

- Brainstorm: [docs/brainstorms/2026-04-29-bigger-mandatory-chips-brainstorm.md](docs/brainstorms/2026-04-29-bigger-mandatory-chips-brainstorm.md)
- Current chip rendering (composer row): [src/components/chat/message-input.tsx:148-166](src/components/chat/message-input.tsx:148)
- Current `extractSuggestions`: [src/components/chat/chat-widget.tsx:64-84](src/components/chat/chat-widget.tsx:64)
- Streaming halt logic (unchanged): [src/app/api/chat/route.ts:21-27](src/app/api/chat/route.ts:21)
- Auto-continue logic (unchanged): [src/components/chat/chat-widget.tsx:44-58](src/components/chat/chat-widget.tsx:44)
- Pre-1ee59bc in-thread chip renderer (reference for restored styles): commit `1ee59bc^:src/components/chat/message-list.tsx:152-190`
- System prompt mandatory call sites: [src/lib/system-prompt.ts:76](src/lib/system-prompt.ts:76), [src/lib/system-prompt.ts:84](src/lib/system-prompt.ts:84)

### External references

None required — local context is sufficient. AI SDK v6 tool input passes through unchanged.

### Related work

- `1ee59bc` refactor(chat): remove in-thread chip rendering from MessageList — partial revert is the substance of this plan.
- `427456f` fix(chat): halt client-rendered tools on outputSchema, polish UX — relevant context for why `showOptions` later switched to auto-resolve.
