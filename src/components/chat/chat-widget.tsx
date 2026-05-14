"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRef, useEffect, useMemo, useState, useCallback } from "react";
import { DisclaimerBanner } from "./disclaimer-banner";
import { MessageList } from "./message-list";
import { MessageInput } from "./message-input";
import { EndChatButton } from "./end-chat-button";
import { EndChatDialog } from "./end-chat-dialog";
import { loadChat, saveChat, clearChat, subscribeToStorage, peekChat, getThisTabId } from "@/lib/chat-persistence";
import type { ChatMessage } from "@/lib/tools";
import { Minus } from "lucide-react";
import Image from "next/image";
import { notifyParent, isEmbedded } from "@/lib/embed-bridge";
import { BRANDING } from "@/lib/branding";
import { FIRM_CONTACT } from "@/lib/contact";

// Cross-tab signaling. Same origin only — BroadcastChannel does not cross
// origins or browsers, which is the security boundary we want.
const STREAM_CHANNEL = "aquarius_chat_stream";
// Slightly longer than the server's maxDuration (30s in app/api/chat/route.ts).
// If a sister tab crashes mid-stream and never broadcasts `end`, this prevents
// other tabs from being disabled forever.
const OTHER_TAB_STREAM_TIMEOUT_MS = 35_000;

type StreamSignal =
  | { type: "start"; sessionId: string }
  | { type: "end"; sessionId: string };

// Cross-tab "how progressed is this transcript" metric. We can't rely on
// messages.length alone because addToolOutput mutates a tool part's state in
// place (input-available → output-available) without adding a new message.
// A length-only guard rejects that save, leaving sister tabs frozen on the
// pre-resolution UI (e.g., still showing "make the payment" after tab 1
// already paid). Counting resolved client-tool parts catches the in-place
// case while strict-greater comparison still breaks echo cycles when a tab
// re-saves something it just adopted.
const RESOLVED_PART_STATES = new Set(["output-available", "output-error"]);
function transcriptProgressScore(messages: ChatMessage[]): number {
  let resolved = 0;
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const p of m.parts) {
      const part = p as { state?: string };
      if (part.state && RESOLVED_PART_STATES.has(part.state)) resolved++;
    }
  }
  // Each message dominates the resolved-parts bonus so a longer transcript
  // always wins over a shorter-but-more-resolved one.
  return messages.length * 1000 + resolved;
}

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

  // Once the booking flow is terminal anywhere in the transcript (urgent
  // contact acknowledged or appointment booked), do NOT auto-continue. We
  // used to slice off the last message here so that the FIRST acknowledgment
  // would still trigger the LLM's closing reply, but DeepSeek violates Step
  // 8 of the system prompt and re-emits showUrgentContact / scheduleAppointment
  // when prompted past terminal — producing stacked duplicate cards and
  // leaked raw tokens. The closing text is appended locally instead (see the
  // terminal-closing useEffect below).
  if (isTerminalState(messages)) return false;

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
  // True when a sister tab on the same origin is mid-stream for this session.
  // Drives input disable + an inline notice so the visitor doesn't double-send.
  const [otherTabStreaming, setOtherTabStreaming] = useState(false);

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

  // Cross-tab merge. When a sister tab finishes a stream and saves to
  // localStorage, the spec fires a `storage` event in every OTHER tab on the
  // same origin. Adopt the newer transcript so this tab converges without a
  // reload. Guards: same sessionId, not currently streaming (our turn is the
  // source of truth while in-flight), and incoming transcript must be MORE
  // progressed than ours by transcriptProgressScore (length + resolved-tool
  // count) — strict-greater so echoes of our own state don't trigger a loop.
  const progressScoreRef = useRef(transcriptProgressScore(messages));
  const statusRef = useRef(status);
  useEffect(() => {
    progressScoreRef.current = transcriptProgressScore(messages);
    statusRef.current = status;
  });
  // Single merge function shared between storage events and the
  // visibility/focus fallbacks below. Encapsulates all the guards.
  const mergeFromCandidate = useCallback(
    (next: { sessionId: string; messages: ChatMessage[]; writerTabId?: string }) => {
      if (next.sessionId !== sessionId) return;
      // Reject merges originating from this tab. peekChat() on visibility/focus
      // re-reads localStorage that this tab itself just wrote; without this
      // guard, a focus event arriving mid-`addToolOutput` flush could revert
      // resolved tool state to the pre-mutation snapshot.
      if (next.writerTabId && next.writerTabId === getThisTabId()) return;
      if (statusRef.current === "streaming" || statusRef.current === "submitted") return;
      if (transcriptProgressScore(next.messages) <= progressScoreRef.current) return;
      setMessages(next.messages);
    },
    [sessionId, setMessages],
  );
  useEffect(() => {
    return subscribeToStorage((next) => {
      if (next === "cleared") return; // sister tab ended chat; don't wipe ours.
      mergeFromCandidate(next);
    });
  }, [mergeFromCandidate]);

  // Defense-in-depth fallback. Browsers (Chromium especially) aggressively
  // throttle background tabs — `storage` events queued while a tab is hidden
  // can be deferred or coalesced, and a backgrounded sister tab may not
  // process the event until you focus it. Re-reading localStorage on
  // visibilitychange and focus catches anything we missed and re-applies the
  // same progress-score guard, so foregrounding a tab always converges it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const recheck = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const next = peekChat();
      if (next) mergeFromCandidate(next);
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [mergeFromCandidate]);

  // Concurrent-submit guard via BroadcastChannel. Tab A broadcasts when it
  // enters streaming so sister tabs can disable input and show an inline
  // notice. The safety timer covers the case where Tab A crashes between
  // `start` and `end` — sister tabs unblock after the timeout instead of
  // staying frozen.
  const otherStreamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(STREAM_CHANNEL);
    channel.onmessage = (e: MessageEvent<StreamSignal>) => {
      const data = e.data;
      if (!data || data.sessionId !== sessionId) return;
      if (data.type === "start") {
        setOtherTabStreaming(true);
        if (otherStreamTimerRef.current) clearTimeout(otherStreamTimerRef.current);
        otherStreamTimerRef.current = setTimeout(() => {
          setOtherTabStreaming(false);
        }, OTHER_TAB_STREAM_TIMEOUT_MS);
      } else if (data.type === "end") {
        setOtherTabStreaming(false);
        if (otherStreamTimerRef.current) {
          clearTimeout(otherStreamTimerRef.current);
          otherStreamTimerRef.current = null;
        }
      }
    };
    return () => {
      channel.close();
      if (otherStreamTimerRef.current) {
        clearTimeout(otherStreamTimerRef.current);
        otherStreamTimerRef.current = null;
      }
    };
  }, [sessionId]);

  // Broadcast our own streaming transitions so sister tabs can react. Posts
  // `start` when we enter streaming/submitted, `end` whenever we leave it.
  // BroadcastChannel does not deliver to the posting context, so we never
  // hear our own messages.
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const isActive = status === "streaming" || status === "submitted";
    if (isActive === wasStreamingRef.current) return;
    wasStreamingRef.current = isActive;
    const channel = new BroadcastChannel(STREAM_CHANNEL);
    const signal: StreamSignal = {
      type: isActive ? "start" : "end",
      sessionId,
    };
    channel.postMessage(signal);
    channel.close();
  }, [status, sessionId]);

  // Append the canned booking-closing reply once the booking flow is
  // terminal. The LLM was supposed to emit this via auto-continue per Step 7
  // of the system prompt, but DeepSeek mis-handles Step 8 and re-emits the
  // booking tools instead, stacking duplicate cards and leaking raw special
  // tokens. We synthesise the closing client-side so the visitor still sees
  // confirmation. Idempotent: skips if the closing is already the last
  // message (e.g., hydrated from a sister tab that already added it, or this
  // tab's own previous render).
  const closingAppendedRef = useRef(false);
  useEffect(() => {
    if (!isTerminalState(messages)) {
      closingAppendedRef.current = false;
      return;
    }
    if (closingAppendedRef.current) return;
    if (statusRef.current === "streaming" || statusRef.current === "submitted") return;
    const closingText = terminalReplyText(messages);
    const last = messages[messages.length - 1];
    const alreadyClosed =
      last?.role === "assistant" &&
      last.parts.some((p) => {
        const part = p as { type?: string; text?: string };
        return part.type === "text" && part.text === closingText;
      });
    closingAppendedRef.current = true;
    if (alreadyClosed) return;
    const closing: ChatMessage = {
      id: `terminal_closing_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      role: "assistant",
      parts: [{ type: "text", text: closingText }],
    };
    setMessages([...messages, closing]);
  }, [messages, setMessages]);

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
    // Belt-and-braces: the input is already disabled when a sister tab is
    // streaming, but suppress here too so a stale event in flight can't fire
    // a duplicate POST against the same session.
    if (otherTabStreaming) return;
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
    <div className="relative flex flex-col h-full bg-white" aria-label={`${BRANDING.tagline} chat`}>
      <header role="banner" className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl overflow-hidden shrink-0">
            <Image
              src="/banjo.png"
              alt=""
              width={36}
              height={36}
              className="h-full w-full object-cover"
            />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-heading font-semibold text-gray-900 truncate">
              {BRANDING.firmName}
            </h1>
            <p className="text-sm text-gray-500">{BRANDING.tagline}</p>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <EndChatButton onClick={() => setEndChatOpen(true)} />
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
        {!isLoading && otherTabStreaming && (
          <div className="text-sm text-gray-700">
            Another tab is responding to this conversation. Please continue there.
          </div>
        )}
      </div>
      <MessageInput
        onSend={handleSend}
        disabled={isLoading || otherTabStreaming}
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
