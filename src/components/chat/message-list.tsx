"use client";

import { Bot, User } from "lucide-react";
import type { ChatMessage } from "@/lib/tools";
import { PaymentCard } from "@/components/payment/payment-card";
import { DocumentUpload } from "@/components/upload/document-upload";

interface MessageListProps {
  messages: ChatMessage[];
  sessionId: string;
  onOptionSelect: (text: string) => void;
  onPaymentComplete: () => void;
  onUploadComplete: (uploaded: number) => void;
  onUploadSkip: () => void;
}

export function MessageList({
  messages,
  sessionId,
  onOptionSelect,
  onPaymentComplete,
  onUploadComplete,
  onUploadSkip,
}: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-center text-gray-400">
        <div>
          <Bot className="h-12 w-12 mx-auto mb-3 text-brand/40" />
          <p className="text-sm">
            Welcome to Aquarius Lawyers. Ask me anything about criminal law.
          </p>
        </div>
      </div>
    );
  }

  // Only show quick-reply buttons for the last assistant message's showOptions
  const lastMsgIndex = messages.length - 1;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.map((message, msgIndex) => (
        <div key={message.id} className="space-y-2">
          {message.parts.map((part, i) => {
            if (part.type === "text" && part.text) {
              const isUser = message.role === "user";
              return (
                <div
                  key={`${message.id}-${i}`}
                  className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}
                >
                  <div
                    className={`shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${
                      isUser ? "bg-gray-200" : "bg-brand/10"
                    }`}
                  >
                    {isUser ? (
                      <User className="h-4 w-4 text-gray-600" />
                    ) : (
                      <Bot className="h-4 w-4 text-brand" />
                    )}
                  </div>
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      isUser
                        ? "bg-brand text-white rounded-br-md"
                        : "bg-gray-100 text-gray-800 rounded-bl-md"
                    }`}
                  >
                    {part.text}
                  </div>
                </div>
              );
            }

            // Quick-reply buttons — only interactive on the last message
            if (part.type === "tool-showOptions" && part.state === "input-available") {
              const isLatest = msgIndex === lastMsgIndex;
              return (
                <div
                  key={part.toolCallId}
                  className="flex flex-wrap gap-2 pl-11"
                >
                  {part.input?.options?.map((option: string) => (
                    <button
                      key={option}
                      onClick={() => isLatest && onOptionSelect(option)}
                      disabled={!isLatest}
                      className={`px-3 py-1.5 rounded-full border text-sm font-medium transition-colors ${
                        isLatest
                          ? "border-brand text-brand hover:bg-brand hover:text-white cursor-pointer"
                          : "border-gray-200 text-gray-400 cursor-default"
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              );
            }

            // Payment tool
            if (part.type === "tool-initiatePayment") {
              if (part.state === "input-available" || part.state === "input-streaming") {
                return (
                  <PaymentCard
                    key={part.toolCallId}
                    sessionId={part.input?.sessionId ?? sessionId}
                    urgency={part.input?.urgency ?? "non-urgent"}
                    displayPrice={part.input?.displayPrice ?? ""}
                    onComplete={onPaymentComplete}
                  />
                );
              }
              if (part.state === "output-available") {
                return (
                  <div
                    key={part.toolCallId}
                    className="mx-11 p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-800"
                  >
                    Payment completed successfully.
                  </div>
                );
              }
            }

            // Upload tool
            if (part.type === "tool-uploadDocuments") {
              if (part.state === "input-available" || part.state === "input-streaming") {
                const isLatest = msgIndex === lastMsgIndex;
                return (
                  <DocumentUpload
                    key={part.toolCallId}
                    sessionId={part.input?.sessionId ?? sessionId}
                    onComplete={isLatest ? onUploadComplete : () => {}}
                    onSkip={isLatest ? onUploadSkip : () => {}}
                  />
                );
              }
              if (part.state === "output-available") {
                return (
                  <div
                    key={part.toolCallId}
                    className="mx-11 p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-800"
                  >
                    Documents submitted.
                  </div>
                );
              }
            }

            return null;
          })}
        </div>
      ))}
    </div>
  );
}
