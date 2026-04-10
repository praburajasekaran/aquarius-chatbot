"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
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

  const { messages, sendMessage, status } = useChat<ChatMessage>({
    transport,
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const isLoading = status === "streaming" || status === "submitted";

  function handleSend(text: string) {
    sendMessage({ text });
  }

  function handlePaymentComplete() {
    sendMessage({
      text: "I have completed the payment.",
    });
  }

  return (
    <div className="flex flex-col h-full bg-white">
      <DisclaimerBanner />
      <MessageList
        messages={messages}
        sessionId={sessionId}
        onOptionSelect={(text) => sendMessage({ text })}
        onPaymentComplete={handlePaymentComplete}
      />
      <div ref={messagesEndRef} />
      {isLoading && (
        <div className="px-4 pb-2">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className="flex gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-brand/40 animate-bounce [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-brand/40 animate-bounce [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-brand/40 animate-bounce [animation-delay:300ms]" />
            </span>
            Typing...
          </div>
        </div>
      )}
      <MessageInput onSend={handleSend} disabled={isLoading} />
    </div>
  );
}
