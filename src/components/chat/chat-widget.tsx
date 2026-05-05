"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRef, useEffect, useMemo, useState } from "react";
import { DisclaimerBanner } from "./disclaimer-banner";
import { MessageList } from "./message-list";
import { MessageInput } from "./message-input";
import { ChatMenu } from "./chat-menu";
import { EndChatDialog } from "./end-chat-dialog";
import { loadChat, saveChat, clearChat } from "@/lib/chat-persistence";
import type { ChatMessage } from "@/lib/tools";
import { Scale, Minus } from "lucide-react";
import { notifyParent, isEmbedded } from "@/lib/embed-bridge";
import { BRANDING } from "@/lib/branding";
import { FIRM_CONTACT } from "@/lib/contact";

// Chips shown alongside the initial assistant greeting, before the visitor
// has sent any message. These mirror the options the AI would emit itself if
// the visitor said "hi" first — rendering them statically avoids a wasted
// round-trip on page load.
const INITIAL_WELCOME_CHIPS = [
  "I've been charged",
  "I need bail advice",
  "Ask about fees",
  "Something else",
];

// Tools that pause the stream when called and need the client to resolve
// them (via addToolOutput). When the user completes one of these, we need
// to resume the AI so it can respond to the result and move to the next
// step. Server-executed tools (matchQuestion, collectDetails, selectUrgency,
// showOptions) handle their continuation inside the same stream and are
// deliberately excluded — auto-continuing on them would loop because they
// are already resolved by the time the client sees the message.
const CLIENT_TOOLS_REQUIRING_CONTINUATION = new Set([
  "tool-initiatePayment",
  "tool-uploadDocuments",
  "tool-scheduleAppointment",
  "tool-showUrgentContact",
]);

// Terminal states reached after the booking flow completes. Once either is
// resolved, no further LLM call is allowed: the model is supposed to stay
// quiet per Step 8 of the system prompt, but DeepSeek frequently re-narrates
// or leaks raw tokens (`<|begin_of_sentence|>`, code fragments) when prompted
// past this boundary. The client enforces the closure the prompt cannot.
function isTerminalState(messages: ChatMessage[]): boolean {
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    for (const p of msg.parts) {
      const part = p as {
        type?: string;
        state?: string;
        output?: { acknowledged?: boolean; booked?: boolean };
      };
      if (part.state !== "output-available") continue;
      if (
        part.type === "tool-showUrgentContact" &&
        part.output?.acknowledged === true
      ) {
        return true;
      }
      if (
        part.type === "tool-scheduleAppointment" &&
        part.output?.booked === true
      ) {
        return true;
      }
    }
  }
  return false;
}

function terminalReplyText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    for (const p of msg.parts) {
      const part = p as {
        type?: string;
        state?: string;
        output?: { acknowledged?: boolean; booked?: boolean };
      };
      if (part.state !== "output-available") continue;
      if (
        part.type === "tool-showUrgentContact" &&
        part.output?.acknowledged === true
      ) {
        return `Thanks — your urgent session is locked in. Please call ${FIRM_CONTACT.phone} to speak with the team. Anything else can be raised directly with your lawyer when you call.`;
      }
      if (
        part.type === "tool-scheduleAppointment" &&
        part.output?.booked === true
      ) {
        return "Thanks — your session is locked in. Anything else can be raised directly with your lawyer when you speak.";
      }
    }
  }
  return "Thanks — your session is locked in. Anything else can be raised directly with your lawyer when you speak.";
}

// Auto-continuation condition. Fires only when one of the whitelisted client
// tools in the last assistant message has entered a resolved state, meaning
// the user has just completed an action (paid, uploaded, booked, etc.) and
// the AI needs to see the result to produce the next turn. Terminal-state
// guard short-circuits before the resolved tool can re-trigger continuation
// after the booking flow has already closed.
function shouldAutoContinue({
  messages,
}: {
  messages: ChatMessage[];
}): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return false;

  const lastHasResolvedClientTool = last.parts.some((p) => {
    const part = p as { type?: string; state?: string };
    if (typeof part.type !== "string") return false;
    if (!CLIENT_TOOLS_REQUIRING_CONTINUATION.has(part.type)) return false;
    return part.state === "output-available" || part.state === "output-error";
  });
  if (!lastHasResolvedClientTool) return false;

  // If the booking flow has already produced its terminal acknowledgement
  // earlier in the transcript, do not trigger another LLM round even if
  // showUrgentContact/scheduleAppointment resolves again on the last message.
  const priorMessages = messages.slice(0, -1);
  if (isTerminalState(priorMessages)) return false;

  return true;
}

// Pull the `options` array from the most recent assistant message's
// showOptions tool call, regardless of tool state. Because showOptions now
// auto-executes on the server, the part's state will be "output-available"
// by the time we render — checking for "input-available" would miss it.
// Mandatory chip groups are skipped: those render in-thread via MessageList,
// so surfacing them in the composer would duplicate the same choice in two
// places.
function extractSuggestions(messages: ChatMessage[]): string[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    // Iterate parts in reverse so we get the most recent showOptions call
    // in the assistant's turn (a single turn may contain multiple tool calls).
    for (let j = msg.parts.length - 1; j >= 0; j--) {
      const part = msg.parts[j];
      if (part.type === "tool-showOptions") {
        const input = part.input;
        if (input?.mandatory === true) return [];
        const options = input?.options;
        if (Array.isArray(options) && options.length > 0) {
          return (options as unknown[]).filter((o): o is string => typeof o === "string");
        }
      }
    }
    // Only inspect the most recent assistant message
    return [];
  }
  return [];
}

export function ChatWidget() {
  const [persisted, setPersisted] = useState(loadChat);
  const { sessionId, initialMessages } = persisted;
  // Track the assistant message ID for which suggestions were dismissed.
  // When a new assistant message arrives (different ID), suggestions reset
  // automatically — no effect needed, avoiding cascading-render lint errors.
  const [dismissedForMessageId, setDismissedForMessageId] = useState<string | null>(null);
  const [endChatOpen, setEndChatOpen] = useState(false);

  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat", body: { sessionId } }),
    [sessionId]
  );

  const { messages, sendMessage, addToolOutput, status, setMessages, stop } = useChat<ChatMessage>({
    transport,
    sendAutomaticallyWhen: shouldAutoContinue,
    messages: initialMessages,
    // Without onError, useChat swallows server failures: status flips to
    // "error" but the existing UI only watches "streaming"/"submitted",
    // leaving the typing indicator stuck. Logging at minimum surfaces the
    // underlying cause in the console for production debugging.
    onError: (err) => {
      console.error("[chat] stream error", err);
    },
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (status !== "ready") return;
    if (messages.length === 0) return;
    saveChat(sessionId, messages);
  }, [messages, status, sessionId]);

  // Resume continuation after hydration. The AI SDK's sendAutomaticallyWhen
  // callback fires only on session-internal mutations (sendMessage,
  // addToolOutput). When we hydrate via the `messages: initialMessages` prop
  // after a page reload, the SDK doesn't re-evaluate that callback — so a
  // rehydrated chat ending in a resolved client tool would sit idle. Calling
  // sendMessage() with no arguments posts the current state to the transport
  // without injecting a phantom user message, allowing the assistant to
  // produce the next turn (e.g., reveal the urgent contact card after a
  // resolved payment).
  const hasResumedAfterHydration = useRef(false);
  useEffect(() => {
    if (hasResumedAfterHydration.current) return;
    hasResumedAfterHydration.current = true;
    if (shouldAutoContinue({ messages: initialMessages })) {
      void sendMessage();
    }
    // We deliberately depend on nothing — this is a strict mount-only effect.
    // initialMessages is captured at first render and never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastAssistantMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i].id;
    }
    return null;
  }, [messages]);

  const isLoading = status === "streaming" || status === "submitted";

  const rawSuggestions = useMemo(() => {
    // Before any message is sent, show the welcome chips alongside the
    // static initial greeting rendered by MessageList.
    if (messages.length === 0) return INITIAL_WELCOME_CHIPS;
    return extractSuggestions(messages);
  }, [messages]);
  // Suggestions are visible unless they were explicitly dismissed for the
  // current assistant message. A new assistant turn resets this automatically
  // because lastAssistantMessageId will differ from dismissedForMessageId.
  // Before any message exists (initial greeting), dismissal is keyed by the
  // sentinel "initial" so typing/sending clears the welcome chips too.
  const suggestionsKey = lastAssistantMessageId ?? "initial";
  const suggestions =
    dismissedForMessageId === suggestionsKey ? [] : rawSuggestions;

  function handleSend(text: string) {
    setDismissedForMessageId(suggestionsKey);

    // Once the booking flow has closed (urgent contact acknowledged or session
    // booked), append the visitor's message and a static reply locally — never
    // call the API. The LLM is no longer trustworthy past this point.
    if (isTerminalState(messages)) {
      const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const userMsg: ChatMessage = {
        id: `terminal_user_${stamp}`,
        role: "user",
        parts: [{ type: "text", text }],
      };
      const assistantMsg: ChatMessage = {
        id: `terminal_assistant_${stamp}`,
        role: "assistant",
        parts: [{ type: "text", text: terminalReplyText(messages) }],
      };
      setMessages([...messages, userMsg, assistantMsg]);
      return;
    }

    sendMessage({ text });
  }

  function handlePaymentComplete(toolCallId: string) {
    addToolOutput({
      tool: "initiatePayment",
      toolCallId,
      output: { status: "completed" },
    });
  }

  function handlePaymentFail(toolCallId: string) {
    addToolOutput({
      tool: "initiatePayment",
      toolCallId,
      output: { status: "failed" },
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

  function handleEndChatConfirm() {
    // Stop any in-flight stream so partial assistant turns don't leak
    // past the reset.
    if (status === "streaming" || status === "submitted") {
      stop();
    }
    // Wipe the localStorage entry first.
    clearChat();
    // Best-effort server cleanup. Never block the UI on this — the server
    // session has its own TTL fallback.
    fetch("/api/chat/session", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    }).catch(() => {
      // Network/server error is acceptable — server-side TTL will reap.
    });
    // Reset the in-memory chat state.
    setMessages([]);
    setDismissedForMessageId(null);
    // Re-mint sessionId by re-running loadChat, which now sees an empty
    // localStorage and returns a fresh sessionId + empty messages.
    setPersisted(loadChat());
    // Close the dialog.
    setEndChatOpen(false);
  }

  return (
    <div className="relative flex flex-col h-full bg-white" aria-label="Criminal Law Assistant chat">
      <header role="banner" className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-brand/10 flex items-center justify-center shrink-0">
            <Scale className="h-5 w-5 text-brand" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-heading font-semibold text-gray-900 truncate">
              {BRANDING.firmName}
            </h1>
            <p className="text-sm text-gray-500">Criminal Law Assistant</p>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <ChatMenu onEndChat={() => setEndChatOpen(true)} />
            )}
            {isEmbedded() && (
              <button
                type="button"
                onClick={() => notifyParent({ source: "aq-chat", type: "minimize" })}
                aria-label="Minimize chat"
                className="inline-flex items-center justify-center h-8 w-8 rounded-full text-slate-600 hover:text-slate-900 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors"
              >
                <Minus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </header>
      <DisclaimerBanner />
      <MessageList
        messages={messages}
        sessionId={sessionId}
        onPaymentComplete={handlePaymentComplete}
        onPaymentFail={handlePaymentFail}
        onUploadComplete={handleUploadComplete}
        onUploadSkip={handleUploadSkip}
        onScheduleBooked={handleScheduleBooked}
        onUrgentAcknowledged={handleUrgentAcknowledged}
        onMandatoryOptionPick={handleSend}
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
        onSuggestionsDismissed={() => setDismissedForMessageId(suggestionsKey)}
      />
      <EndChatDialog
        open={endChatOpen}
        onConfirm={handleEndChatConfirm}
        onCancel={() => setEndChatOpen(false)}
      />
    </div>
  );
}
