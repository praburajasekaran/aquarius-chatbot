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

export function ChatWidget() {
  const [sessionId] = useState(generateSessionId);

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

  const isLoading = status === "streaming" || status === "submitted";

  function handleSend(text: string) {
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

  return (
    <div className="flex flex-col h-full bg-white" aria-label="Criminal Law Assistant chat">
      <DisclaimerBanner />
      <MessageList
        messages={messages}
        sessionId={sessionId}
        onOptionSelect={(toolCallId, text) =>
          addToolOutput({ tool: "showOptions", toolCallId, output: { selected: text } })
        }
        onPaymentComplete={handlePaymentComplete}
        onUploadComplete={handleUploadComplete}
        onUploadSkip={handleUploadSkip}
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
      <MessageInput onSend={handleSend} disabled={isLoading} />
    </div>
  );
}
