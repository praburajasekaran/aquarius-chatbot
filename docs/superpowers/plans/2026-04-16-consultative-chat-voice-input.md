# Consultative Chat UX + Voice Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chatbot feel consultative (free-form conversation primary, suggestion chips secondary), and add Web Speech API voice input to the message composer.

**Architecture:**
- `showOptions` tool becomes non-blocking by adding an `execute` function that auto-resolves. Chip rendering moves from the message thread into the input composer as a "Quick reply" row above the textarea. A mic button is added to the composer using the browser-native Web Speech API.

**Tech Stack:** Next.js (App Router), TypeScript, Vercel AI SDK v6 (`@ai-sdk/react`, `ai`), Tailwind CSS v4, Lucide React icons, Web Speech API (browser-native).

**Testing note:** This project has no unit test framework. Verification is done by running `npm run lint`, `npm run build`, and manually testing the chatbot in `npm run dev` at `http://localhost:3000`.

**Reference spec:** `docs/superpowers/specs/2026-04-16-consultative-chat-voice-input-design.md`

---

## File Map

**Modify:**
- `src/lib/tools/show-options.ts` — add `execute`, update description
- `src/lib/system-prompt.ts` — rewrite persona, constrain `showOptions` usage
- `src/components/chat/message-list.tsx` — remove `tool-showOptions` rendering branch and `onOptionSelect` prop
- `src/components/chat/message-input.tsx` — add `suggestions` prop + chip row, add mic button + Web Speech logic, update placeholder
- `src/components/chat/chat-widget.tsx` — extract suggestions from last assistant message, remove `onOptionSelect` handler, pass suggestions into `MessageInput`

**Create:**
- `src/types/speech-recognition.d.ts` — ambient types for `SpeechRecognition` and `webkitSpeechRecognition` (not in TypeScript's default DOM lib)

---

## Task 1: Update `showOptions` tool to be non-blocking

**Files:**
- Modify: `src/lib/tools/show-options.ts`

- [ ] **Step 1: Read the current file**

Run: `cat src/lib/tools/show-options.ts`

Expected output: the existing tool definition with no `execute`.

- [ ] **Step 2: Replace the file with the non-blocking version**

Replace the entire contents of `src/lib/tools/show-options.ts` with:

```typescript
import { tool } from "ai";
import { z } from "zod";

// Renders suggestion chips client-side. Has an execute function that
// auto-resolves so the AI stream never halts — the chips are purely
// optional shortcuts. The user may click a chip (which sends the text as
// a normal user message) or ignore them entirely and type freely.
export const showOptions = tool({
  description:
    "Display optional suggestion chips for the visitor. Use SPARINGLY — only at clear action points (book a session, proceed to payment, urgent escalation) or for tightly scoped yes/no questions. For open-ended information gathering, ask conversationally and let the visitor type freely. Do not use after every response. Always provide 2–4 short, clear options when used.",
  inputSchema: z.object({
    options: z
      .array(z.string())
      .min(2)
      .max(4)
      .describe("The chip labels to show, e.g. ['Yes, proceed', 'Ask another question']"),
  }),
  execute: async () => {
    // Auto-resolves immediately. The chips are purely UI — the AI does not
    // wait for a selection. When the user sends a message (via chip click
    // or free-form typing), the AI responds to that message naturally.
    return { acknowledged: true } as const;
  },
});
```

- [ ] **Step 3: Run lint and typecheck**

Run: `npm run lint`

Expected: no errors. If TypeScript complains about the inferred output type not matching `{ selected: string }` anywhere else, that's expected — we'll fix those in later tasks.

- [ ] **Step 4: Run build to surface type errors**

Run: `npm run build`

Expected: build will likely fail with TypeScript errors in files that reference `output.selected`. That's fine — note the error locations, we'll fix them in the next tasks. If build succeeds, continue.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tools/show-options.ts
git commit -m "refactor(tools): make showOptions non-blocking with auto-executing tool"
```

---

## Task 2: Update system prompt to consultative persona

**Files:**
- Modify: `src/lib/system-prompt.ts`

- [ ] **Step 1: Replace the file with the consultative version**

Replace the entire contents of `src/lib/system-prompt.ts` with:

```typescript
import { BRANDING } from "@/lib/branding";

export const systemPrompt = `You are the ${BRANDING.firmName} ${BRANDING.tagline}. You are the first point of contact for visitors to the ${BRANDING.firmName} website seeking help with criminal law matters. Your job is to listen, ask good questions, gather context, and guide appropriate visitors toward booking a Legal Strategy Session.

## YOUR PERSONA

You are warm, curious, and genuinely helpful — like a senior lawyer's assistant who takes the time to understand each person's situation before recommending a next step. You are NOT a menu-driven bot. You have real consultative conversations.

- Ask clarifying questions to understand what happened before suggesting options.
- Build a picture of the client's situation over 2–4 short exchanges.
- Reflect back what you've heard so the client feels understood.
- Do not rush to propose a booking. Earn it by showing you understand the matter.
- If the situation is clearly urgent (imminent court date, custody at risk, serious immediate exposure), cut the exploration short and escalate quickly — do not drag it out.
- Keep each response short (1–3 sentences). Long paragraphs feel transactional.

## CRITICAL RULES

1. ALWAYS call the matchQuestion tool when a visitor asks ANY criminal law question — never answer from your own knowledge.
2. After matchQuestion returns a result, present the answer in friendly, plain language.
3. If matchQuestion returns matched: false, use the fallback response below.
4. Never generate legal advice from memory — only relay what the knowledge base returns.
5. NEVER repeat the welcome message after the first greeting. It is a ONE-TIME greeting.
6. NEVER judge phone or email format yourself. The ONLY way to determine validity is to call collectDetails and read the errors it returns. If you have ANY candidate string for all four fields (name, email, phone, description) — even a single word like "bail" — you MUST call collectDetails on that very turn.
7. If the visitor has already given all four fields across prior messages and the latest message adds/updates any one of them, call collectDetails again with the updated values.
8. NEVER send the final scheduling step before uploadDocuments has returned. NEVER call both scheduleAppointment and showUrgentContact in the same conversation. Route strictly by the urgency captured in Step 3.

## WHEN TO USE showOptions (SUGGESTION CHIPS)

Suggestion chips are optional shortcuts rendered as a small row next to the text input. They appear alongside (not instead of) the free-form input. The visitor may click a chip OR type their own response.

Use showOptions ONLY in these cases:
- Clear binary action points: "Yes, proceed" / "No, let me think"
- Tightly scoped choices with a fixed answer set: "Urgent — \$1,320" / "Non-urgent — \$726"
- Next-step nudges after a concrete resolution: "Book a session" / "Ask another question"
- Welcome-message initial branches

DO NOT use showOptions:
- After a conversational question where the visitor might have a free-form answer (e.g. "What happened?", "Can you tell me more?").
- As a substitute for asking an open-ended question.
- After every response by default.

The showOptions tool auto-resolves immediately — the AI does NOT wait for a chip click. When the visitor's next message arrives (whether from a chip click or typed freely), respond to it naturally as a regular user message.

## CONVERSATION FLOW

Step 1 — GREET AND EXPLORE
- If the visitor's first message is a criminal law question, IMMEDIATELY call matchQuestion. Do not greet first.
- If the visitor's first message is a simple greeting (hi, hello) with no substance, respond with the welcome message below, then call showOptions with ["I've been charged", "I need bail advice", "Ask about fees", "Something else"].
- If the visitor describes their situation in their first message, ACKNOWLEDGE it warmly and ask a follow-up question to understand more. Do NOT show chips after an exploratory question.
  • Example: visitor says "I got a speeding fine" → "Thanks for reaching out. To make sure I point you in the right direction, could you tell me a bit more — is this your first offence, or have there been prior matters?" — NO chips.

Step 2 — UNDERSTAND THE MATTER
- Ask 1–3 clarifying questions to understand what happened. Stay open-ended.
- Do NOT call showOptions during this exploration phase.
- Once you have enough context to recommend a next step, summarize what you've understood and suggest booking a session. Call showOptions with ["Yes, I'd like to book a session", "I have another question"].

Step 3 — COLLECT DETAILS
- When the visitor is ready to proceed, ask for: full name, email, Australian phone, and a brief matter description.
- PARSE EVERY MESSAGE THOROUGHLY. The visitor often provides multiple fields in a single message. Extract ALL of:
  • Name — any personal name, even a single first name
  • Email — any token containing "@"
  • Phone — any string of digits matching Australian phone patterns
  • Matter description — any remaining free-text (even one word like "bail", "assault")
- Track accumulated fields across messages. Combine new fields with what you already have.
- If any fields are STILL missing, ACKNOWLEDGE what you've received and ask ONLY for what's missing.
- Only call collectDetails once you have ALL four fields. Pass every field in a single tool call.
- DO NOT validate phone or email yourself. Trust the tool.
- If collectDetails returns valid: false, relay the errors array VERBATIM (one per line) and ask only for the fields those errors mention.

Step 4 — SELECT URGENCY
- Briefly explain the two options, then call BOTH selectUrgency AND showOptions together:
  • showOptions: ["Urgent — \$1,320", "Non-urgent — \$726"]
  • selectUrgency is called after the visitor picks one. Pass { sessionId, urgency, clientName, clientEmail, clientPhone, matterDescription } — reuse the fields collected in Step 3.
- Do not announce the confirmation email that selectUrgency sends.

Step 5 — CONFIRM SELECTION
- After selectUrgency completes, briefly restate the selection and cost, then call showOptions with ["Yes, please proceed", "No, I don't want to proceed"].
- If the visitor picks "No, I don't want to proceed", offer to answer more questions or revisit the urgency choice. Do not call initiatePayment.

Step 6 — PAYMENT
- Call initiatePayment only after the visitor picks "Yes, please proceed".

Step 7 — SCHEDULE OR CONTACT
- After uploadDocuments completes, route based on urgency:
  • Non-urgent → call scheduleAppointment with { sessionId, prefillName, prefillEmail, matterDescription }.
  • Urgent → call showUrgentContact with { sessionId }.
- Never call both tools. Never mix the two routes.
- After scheduleAppointment returns { booked: true }: "Your session is confirmed. Calendly will send you a calendar invite and a confirmation email shortly. We look forward to speaking with you."
- After showUrgentContact returns { acknowledged: true }: "Thanks. We'll be ready as soon as you call us. If you reach voicemail outside business hours, leave your details and we'll return your call first thing."

## URGENT MATTERS (SHORT-CIRCUIT)

If the visitor mentions signals of urgency — "court tomorrow", "arrested", "in custody", "bail hearing this week", "police holding" — SKIP the exploration phase. Acknowledge urgency, reassure, and move directly to Step 3 (collect details). In Step 4, the natural choice is Urgent.

## FALLBACK RESPONSE

If matchQuestion returns matched: false:
"That's a great question. While I can help with many common criminal law queries, this one would be best answered by one of our lawyers directly. Would you like to book a Legal Strategy Session so we can address your specific situation?"

Then call showOptions with ["Book a Legal Strategy Session", "Ask another question"].

## TONE

- Professional but warm and empathetic — visitors may be stressed or frightened
- Plain language, no legal jargon
- Brief: 1–3 sentences per response
- Curious and consultative, not transactional

## WELCOME MESSAGE (first greeting only — NEVER repeat)

"${BRANDING.welcomeMessage}"

This welcome message must only appear ONCE at the very start. After the visitor responds, progress the conversation forward — never loop back.`;
```

- [ ] **Step 2: Verify no syntax errors**

Run: `npm run lint`

Expected: no lint errors related to `system-prompt.ts`. (Other files may still have errors from Task 1 — that's expected and will be fixed in later tasks.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/system-prompt.ts
git commit -m "feat(prompt): rewrite system prompt for consultative intake persona"
```

---

## Task 3: Remove `showOptions` rendering and `onOptionSelect` prop from MessageList

**Files:**
- Modify: `src/components/chat/message-list.tsx`

- [ ] **Step 1: Remove `onOptionSelect` from `MessageListProps`**

Edit `src/components/chat/message-list.tsx`. In the `MessageListProps` interface, delete the line:

```typescript
  onOptionSelect: (toolCallId: string, text: string) => void;
```

- [ ] **Step 2: Remove `onOptionSelect` from the destructured function signature**

In the same file, in the `MessageList` function parameters, delete the line:

```typescript
  onOptionSelect,
```

- [ ] **Step 3: Delete the entire `tool-showOptions` rendering block**

In the same file, delete the entire block starting with the comment `// Quick-reply buttons — interactive only on the latest unanswered group.` down through the closing `}` of that `if (part.type === "tool-showOptions" && ...)` branch (approximately lines 150–190 in the current file). The block renders the `<div role="group" aria-label="Quick reply options">`. After deletion, the next block should be the `// Payment tool` comment.

- [ ] **Step 4: Run lint**

Run: `npm run lint`

Expected: lint may still fail because `chat-widget.tsx` still passes `onOptionSelect`. That's fine — we fix it in Task 5.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/message-list.tsx
git commit -m "refactor(chat): remove in-thread chip rendering from MessageList"
```

---

## Task 4: Add suggestions chip row and mic button to MessageInput

**Files:**
- Modify: `src/components/chat/message-input.tsx`
- Create: `src/types/speech-recognition.d.ts`

- [ ] **Step 1: Create the ambient types file for Web Speech API**

Create `src/types/speech-recognition.d.ts` with the following contents:

```typescript
// Ambient types for the Web Speech API. The Speech Recognition interfaces
// are not in TypeScript's default DOM lib because they're not yet part of
// the official spec — Chromium and Safari expose them under the vendor
// prefix `webkitSpeechRecognition`.

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((this: SpeechRecognition, ev: Event) => void) | null;
  onstart: ((this: SpeechRecognition, ev: Event) => void) | null;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}

interface Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}
```

- [ ] **Step 2: Replace `message-input.tsx` with the new version**

Replace the entire contents of `src/components/chat/message-input.tsx` with:

```typescript
"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { SendHorizonal, Mic, MicOff } from "lucide-react";

interface MessageInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  suggestions?: string[];
  onSuggestionsDismissed?: () => void;
}

export function MessageInput({
  onSend,
  disabled,
  suggestions,
  onSuggestionsDismissed,
}: MessageInputProps) {
  const [input, setInput] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Detect Web Speech API support on mount. Hidden gracefully if unsupported.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (Ctor) setSpeechSupported(true);
  }, []);

  useEffect(() => {
    if (!disabled) textareaRef.current?.focus();
  }, [disabled]);

  // Stop any active recognition on unmount to avoid leaking audio capture
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setInput("");
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleChipClick(text: string) {
    if (disabled) return;
    onSend(text);
  }

  function handleInputChange(value: string) {
    setInput(value);
    // First keystroke dismisses the chip row — chips are only useful before
    // the user commits to typing.
    if (value.length > 0 && suggestions && suggestions.length > 0) {
      onSuggestionsDismissed?.();
    }
  }

  function handleMicClick() {
    if (isListening) {
      recognitionRef.current?.abort();
      setIsListening(false);
      return;
    }

    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-AU";
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      if (transcript) {
        setInput(transcript);
        // Focus so the user can review/edit before sending
        textareaRef.current?.focus();
      }
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      // start() throws if already running — reset state just in case
      setIsListening(false);
    }
  }

  const showChips = Array.isArray(suggestions) && suggestions.length > 0 && input.length === 0;

  return (
    <div className="border-t border-gray-200">
      {showChips && (
        <div className="px-3 pt-2 flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-gray-400 whitespace-nowrap">
            Quick reply
          </span>
          <span aria-hidden="true" className="h-3 w-px bg-gray-200" />
          {suggestions!.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => handleChipClick(option)}
              disabled={disabled}
              className="px-2.5 py-1 rounded-md border border-gray-200 bg-gray-50 text-gray-600 text-xs font-medium hover:bg-gray-100 hover:border-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {option}
            </button>
          ))}
        </div>
      )}

      <div className="p-3">
        <div className="flex items-end gap-2">
          <label htmlFor="chat-input" className="sr-only">
            Type your message
          </label>
          <textarea
            ref={textareaRef}
            id="chat-input"
            autoFocus
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Feel free to type anything here..."
            disabled={disabled}
            rows={1}
            /* text-base (16px) is the strict minimum to prevent iOS auto-zoom on focus */
            className="flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-base focus:border-[#085a66] focus:outline-none focus:ring-2 focus:ring-[#085a66] disabled:opacity-50"
          />

          {speechSupported && (
            <button
              type="button"
              onClick={handleMicClick}
              disabled={disabled}
              aria-label={isListening ? "Stop voice input" : "Start voice input"}
              aria-pressed={isListening}
              className={`shrink-0 h-11 w-11 rounded-xl flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                isListening
                  ? "bg-red-500 text-white hover:bg-red-600 animate-pulse"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {isListening ? (
                <MicOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Mic className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          )}

          {/* h-11 w-11 = 44px — meets WCAG 2.5.5 AAA minimum touch target */}
          <button
            type="button"
            onClick={handleSend}
            disabled={disabled || !input.trim()}
            aria-label="Send message"
            className="shrink-0 h-11 w-11 rounded-xl bg-[#085a66] text-white flex items-center justify-center hover:bg-[#064550] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <SendHorizonal className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run lint**

Run: `npm run lint`

Expected: no errors for `message-input.tsx` or `speech-recognition.d.ts`. `chat-widget.tsx` may still error — we fix that next.

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/message-input.tsx src/types/speech-recognition.d.ts
git commit -m "feat(chat): add suggestion chips and voice input to composer"
```

---

## Task 5: Wire suggestions into ChatWidget and remove onOptionSelect

**Files:**
- Modify: `src/components/chat/chat-widget.tsx`

- [ ] **Step 1: Replace `chat-widget.tsx` with the updated version**

Replace the entire contents of `src/components/chat/chat-widget.tsx` with:

```typescript
"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { useRef, useEffect, useMemo, useState } from "react";
import { DisclaimerBanner } from "./disclaimer-banner";
import { MessageList } from "./message-list";
import { MessageInput } from "./message-input";
import type { ChatMessage } from "@/lib/tools";

function generateSessionId() {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// Pull the `options` array from the most recent assistant message's
// showOptions tool call, regardless of tool state. Because showOptions now
// auto-executes on the server, the part's state will be "output-available"
// by the time we render — checking for "input-available" would miss it.
function extractSuggestions(messages: ChatMessage[]): string[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    // Iterate parts in reverse so we get the most recent showOptions call
    // in the assistant's turn (a single turn may contain multiple tool calls).
    for (let j = msg.parts.length - 1; j >= 0; j--) {
      const part = msg.parts[j];
      if (part.type === "tool-showOptions") {
        const options = part.input?.options;
        if (Array.isArray(options) && options.length > 0) {
          return options;
        }
      }
    }
    // Only inspect the most recent assistant message
    return [];
  }
  return [];
}

export function ChatWidget() {
  const [sessionId] = useState(generateSessionId);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);

  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat" }),
    []
  );

  const { messages, sendMessage, addToolOutput, status } = useChat<ChatMessage>({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Reset "dismissed" flag whenever a new assistant message arrives so fresh
  // suggestions show again. We key off message count because new suggestions
  // naturally come with a new assistant turn.
  const lastAssistantMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i].id;
    }
    return null;
  }, [messages]);

  useEffect(() => {
    setSuggestionsDismissed(false);
  }, [lastAssistantMessageId]);

  const isLoading = status === "streaming" || status === "submitted";

  const rawSuggestions = useMemo(() => extractSuggestions(messages), [messages]);
  const suggestions = suggestionsDismissed ? [] : rawSuggestions;

  function handleSend(text: string) {
    setSuggestionsDismissed(true);
    sendMessage({ text });
  }

  function handlePaymentComplete(toolCallId: string) {
    addToolOutput({
      tool: "initiatePayment",
      toolCallId,
      output: { status: "completed" },
    });
  }

  function handleUploadComplete(toolCallId: string, uploaded: number) {
    addToolOutput({
      tool: "uploadDocuments",
      toolCallId,
      output: { uploaded },
    });
  }

  function handleUploadSkip(toolCallId: string) {
    addToolOutput({
      tool: "uploadDocuments",
      toolCallId,
      output: { uploaded: 0 },
    });
  }

  function handleScheduleBooked(
    toolCallId: string,
    result: { eventStartTime: string; eventUri: string; inviteeUri: string }
  ) {
    addToolOutput({
      tool: "scheduleAppointment",
      toolCallId,
      output: {
        booked: true,
        eventStartTime: result.eventStartTime,
        eventUri: result.eventUri,
        inviteeUri: result.inviteeUri,
      },
    });
  }

  function handleUrgentAcknowledged(toolCallId: string) {
    addToolOutput({
      tool: "showUrgentContact",
      toolCallId,
      output: { acknowledged: true },
    });
  }

  return (
    <div className="flex flex-col h-full bg-white" aria-label="Criminal Law Assistant chat">
      <DisclaimerBanner />
      <MessageList
        messages={messages}
        sessionId={sessionId}
        onPaymentComplete={handlePaymentComplete}
        onUploadComplete={handleUploadComplete}
        onUploadSkip={handleUploadSkip}
        onScheduleBooked={handleScheduleBooked}
        onUrgentAcknowledged={handleUrgentAcknowledged}
      />
      <div ref={messagesEndRef} />
      {/* aria-live region announces typing state to screen readers */}
      <div role="status" aria-live="polite" aria-atomic="true" className="px-4 pb-2 min-h-[2rem]">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-gray-700">
            {/* Decorative dots — hidden from AT */}
            <span className="flex gap-1" aria-hidden="true">
              <span className="h-1.5 w-1.5 rounded-full bg-brand/60 animate-bounce [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-brand/60 animate-bounce [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-brand/60 animate-bounce [animation-delay:300ms]" />
            </span>
            Typing...
          </div>
        )}
      </div>
      <MessageInput
        onSend={handleSend}
        disabled={isLoading}
        suggestions={suggestions}
        onSuggestionsDismissed={() => setSuggestionsDismissed(true)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Run lint**

Run: `npm run lint`

Expected: no errors.

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: build succeeds. If TypeScript complains about `part.input` possibly being undefined, that's expected for AI SDK tool part types — the `Array.isArray` guard handles it safely. If the build still fails on those access patterns, adjust with optional chaining until it passes (the code above uses `part.input?.options` which should be correct).

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/chat-widget.tsx
git commit -m "feat(chat): wire suggestions from last assistant message into composer"
```

---

## Task 6: Manual verification — consultative chips flow

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

Expected: server starts on `http://localhost:3000`.

- [ ] **Step 2: Test welcome flow**

Open `http://localhost:3000` in Chrome. Send "hi".

Expected:
- Welcome message appears
- "Quick reply" chip row appears ABOVE the text input (not next to the welcome message)
- Chips visible: "I've been charged", "I need bail advice", "Ask about fees", "Something else"
- Text input placeholder: "Feel free to type anything here..."
- Mic button is visible (Chrome supports Web Speech API)

- [ ] **Step 3: Test consultative flow (free-form typing)**

In the same session, type: "I got a speeding fine" and send (ignore chips).

Expected:
- Chips disappear
- AI responds with a consultative follow-up question (e.g., "Is this your first offence?" or similar) — NOT a chip selection
- No chip row should appear after the AI's exploratory question

- [ ] **Step 4: Test chip-click behaviour**

Reload the page. When welcome chips appear, click "I've been charged".

Expected:
- The chip text ("I've been charged") is sent as a user message (visible in the thread as a user bubble)
- Chips disappear
- AI responds with empathy and asks a follow-up or moves toward collecting details

- [ ] **Step 5: Test typing-to-dismiss behaviour**

Reload. When chips appear, start typing in the textarea (don't send yet).

Expected:
- Chips fade/disappear as soon as the first character is typed
- Text input receives focus normally

- [ ] **Step 6: Test urgency flow still works**

Start a new session. Go through: "hi" → "I've been charged" → answer the follow-up questions → provide name, email, phone, matter description → proceed.

Expected:
- At Step 4 (urgency selection), chips appear: "Urgent — $1,320" / "Non-urgent — $726"
- Clicking one sends it as a message and the AI continues appropriately
- At Step 5, chips appear: "Yes, please proceed" / "No, I don't want to proceed"

- [ ] **Step 7: Commit nothing (verification task)**

Nothing to commit. If any of the above fail, fix the underlying file and re-verify before moving on.

---

## Task 7: Manual verification — voice input

**Files:** none (verification only)

- [ ] **Step 1: Test voice input in Chrome**

With dev server running, open `http://localhost:3000` in Chrome. Tap the mic button.

Expected:
- Browser requests microphone permission (first time only)
- Mic icon switches to red with a pulse animation (`MicOff` icon visible)
- Speak a phrase like "I got a speeding fine"
- After you stop speaking, the transcript appears in the textarea
- Mic icon returns to idle state (grey `Mic`)
- Textarea is focused with the transcript — cursor at end
- You can edit the transcript, then hit send

- [ ] **Step 2: Test cancelling voice input**

Tap the mic button. While it's listening (red, pulsing), tap it again before speaking.

Expected:
- Recognition aborts
- Mic returns to idle state
- Textarea is unchanged (empty)

- [ ] **Step 3: Test voice input in Safari (if available)**

If you have access to Safari on macOS or iOS, repeat Step 1 there.

Expected: same behaviour as Chrome.

- [ ] **Step 4: Test graceful degradation in Firefox (if available)**

If you have Firefox installed, open `http://localhost:3000` there.

Expected: mic button is NOT rendered. Only textarea and send button are visible. Typing and sending still work normally.

- [ ] **Step 5: Commit nothing (verification task)**

Nothing to commit. If any of the above fail, fix `message-input.tsx` and re-verify.

---

## Task 8: Final lint, build, and end-to-end smoke test

**Files:** none (verification only)

- [ ] **Step 1: Run lint**

Run: `npm run lint`

Expected: zero errors, zero warnings.

- [ ] **Step 2: Run build**

Run: `npm run build`

Expected: clean build, no TypeScript errors.

- [ ] **Step 3: Full conversational smoke test**

Start `npm run dev`. Run a complete non-urgent flow end to end:

1. "hi" → welcome + chips
2. Click "I've been charged" → empathetic response + follow-up question (no chips)
3. Type "I got in a fight at a bar" → AI asks a clarifying question (no chips)
4. Answer: "First time" → AI summarises and offers booking + chips appear
5. Click "Yes, I'd like to book a session" → AI asks for name/email/phone/description
6. Provide all four in one message: "John Smith, 0412 345 678, john@example.com, bar fight"
7. AI confirms and asks urgency with chips
8. Click "Non-urgent — $726"
9. AI confirms selection with chips
10. Click "Yes, please proceed" → payment card appears

Expected:
- Chips appear ONLY at: welcome, booking nudge, urgency selection, confirmation
- Chips do NOT appear after exploratory questions
- Every chip click sends as a normal user message
- Voice input works at any step in Chrome/Safari

- [ ] **Step 4: Urgent path smoke test**

Start a fresh session. Type: "I have a court date tomorrow and I've been charged with assault".

Expected:
- AI recognises urgency, skips extended exploration
- Moves to collect details quickly
- At urgency step, Urgent is the natural choice
- At the end, `showUrgentContact` card is shown (not Calendly)

- [ ] **Step 5: No commit needed (verification task)**

If all smoke tests pass, the implementation is complete.

---

## Acceptance Criteria (spec coverage)

- [x] `showOptions` is non-blocking (has `execute`) — Task 1
- [x] System prompt rewritten for consultative persona with usage rules for `showOptions` — Task 2
- [x] Chips removed from the message thread — Task 3
- [x] Chips rendered in the input zone as a "Quick reply" row above the textarea — Task 4
- [x] Chip styling matches spec (small, square-cornered, muted grey) — Task 4
- [x] Clicking a chip calls `sendMessage(text)` path as a normal user message — Task 4 + Task 5
- [x] Chips disappear when user types the first character — Task 4
- [x] Chips disappear when any message is sent — Task 4 (input cleared) + Task 5 (dismissed flag)
- [x] Chip row hidden entirely when no suggestions — Task 4 (`showChips` guard)
- [x] Placeholder is "Feel free to type anything here…" — Task 4
- [x] Mic button in MessageInput with idle / listening / unsupported states — Task 4
- [x] Web Speech API config: `interimResults: false`, `lang: "en-AU"`, `continuous: false` — Task 4
- [x] Transcript replaces textarea content and focuses textarea; no auto-send — Task 4
- [x] Mic button hidden on unsupported browsers (Firefox) — Task 4
- [x] `onOptionSelect` and `addToolOutput` for `showOptions` removed from ChatWidget — Task 5
