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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const options = (part.input as any)?.options;
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
  const [sessionId] = useState(generateSessionId);
  // Track the assistant message ID for which suggestions were dismissed.
  // When a new assistant message arrives (different ID), suggestions reset
  // automatically — no effect needed, avoiding cascading-render lint errors.
  const [dismissedForMessageId, setDismissedForMessageId] = useState<string | null>(null);

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

  const lastAssistantMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i].id;
    }
    return null;
  }, [messages]);

  const isLoading = status === "streaming" || status === "submitted";

  const rawSuggestions = useMemo(() => extractSuggestions(messages), [messages]);
  // Suggestions are visible unless they were explicitly dismissed for the
  // current assistant message. A new assistant turn resets this automatically
  // because lastAssistantMessageId will differ from dismissedForMessageId.
  const suggestions =
    dismissedForMessageId === lastAssistantMessageId ? [] : rawSuggestions;

  function handleSend(text: string) {
    setDismissedForMessageId(lastAssistantMessageId);
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
        onSuggestionsDismissed={() => setDismissedForMessageId(lastAssistantMessageId)}
      />
    </div>
  );
}
