"use client";

import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { Bot, User } from "lucide-react";
import type { ChatMessage } from "@/lib/tools";
import { PaymentCard } from "@/components/payment/payment-card";
import { DocumentUpload } from "@/components/upload/document-upload";
import { CalendlyEmbed } from "@/components/booking/calendly-embed";
import { UrgentContactCard } from "@/components/booking/urgent-contact-card";
import { BRANDING } from "@/lib/branding";

interface MessageListProps {
  messages: ChatMessage[];
  sessionId: string;
  onPaymentComplete: (toolCallId: string) => void;
  onUploadComplete: (toolCallId: string, uploaded: number) => void;
  onUploadSkip: (toolCallId: string) => void;
  onScheduleBooked: (
    toolCallId: string,
    result: { eventStartTime: string; eventUri: string; inviteeUri: string }
  ) => void;
  onUrgentAcknowledged: (toolCallId: string) => void;
}

export function MessageList({
  messages,
  sessionId,
  onPaymentComplete,
  onUploadComplete,
  onUploadSkip,
  onScheduleBooked,
  onUrgentAcknowledged,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Serialize visible text so streaming token updates also trigger scroll,
  // not just new message arrivals.
  const scrollKey = messages
    .map((m) =>
      m.parts
        .map((p) => ("text" in p && typeof p.text === "string" ? p.text : p.type))
        .join("|")
    )
    .join("~");

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [scrollKey]);

  if (messages.length === 0) {
    // Show the welcome message as a proper assistant bubble on mount so the
    // AI greets the visitor first, instead of an empty canvas that requires
    // the visitor to type the first message. The suggestion chips for this
    // initial state are provided by ChatWidget through MessageInput.
    return (
      <div role="log" aria-label="Conversation" className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex gap-3">
          <div
            aria-hidden="true"
            className="shrink-0 h-8 w-8 rounded-full flex items-center justify-center bg-brand/10"
          >
            <Bot className="h-4 w-4 text-brand" />
          </div>
          <div
            aria-label={`Assistant: ${BRANDING.welcomeMessage}`}
            className="max-w-[80%] rounded-2xl px-4 py-2.5 text-base leading-relaxed bg-gray-100 text-gray-800 rounded-bl-md"
          >
            {BRANDING.welcomeMessage}
          </div>
        </div>
      </div>
    );
  }

  const lastMsgIndex = messages.length - 1;

  return (
    /* role="log" has implicit aria-live="polite" — new messages announced to screen readers */
    <div ref={scrollRef} role="log" aria-label="Conversation" className="flex-1 overflow-y-auto p-4 space-y-4">
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
                  {/* Avatar — decorative, hidden from AT */}
                  <div
                    aria-hidden="true"
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
                    aria-label={`${isUser ? "You" : "Assistant"}: ${part.text}`}
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-base leading-relaxed ${
                      isUser
                        ? "bg-[#085a66] text-white rounded-br-md"
                        : "bg-gray-100 text-gray-800 rounded-bl-md"
                    }`}
                  >
                    {isUser ? (
                      part.text
                    ) : (
                      /* Render markdown from the model so **bold**, *italic*, lists etc.
                         become real HTML instead of showing literal asterisks. Plain
                         CommonMark only — no raw HTML, no rehype plugins. */
                      <div className="prose-chat">
                        <ReactMarkdown
                          components={{
                            p: ({ children }) => (
                              <p className="[&:not(:first-child)]:mt-2">{children}</p>
                            ),
                            ul: ({ children }) => (
                              <ul className="list-disc pl-5 [&:not(:first-child)]:mt-2 space-y-1">
                                {children}
                              </ul>
                            ),
                            ol: ({ children }) => (
                              <ol className="list-decimal pl-5 [&:not(:first-child)]:mt-2 space-y-1">
                                {children}
                              </ol>
                            ),
                            strong: ({ children }) => (
                              <strong className="font-semibold">{children}</strong>
                            ),
                            a: ({ href, children }) => (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#085a66] underline underline-offset-2"
                              >
                                {children}
                              </a>
                            ),
                          }}
                        >
                          {part.text}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            // Payment tool
            if (part.type === "tool-initiatePayment") {
              if (part.state === "input-available" || part.state === "input-streaming") {
                const isLatest = msgIndex === lastMsgIndex;
                return (
                  <PaymentCard
                    key={part.toolCallId}
                    sessionId={part.input?.sessionId ?? sessionId}
                    urgency={part.input?.urgency ?? "non-urgent"}
                    displayPrice={part.input?.displayPrice ?? ""}
                    onComplete={isLatest ? () => onPaymentComplete(part.toolCallId) : () => {}}
                  />
                );
              }
              if (part.state === "output-available") {
                return (
                  <div
                    key={part.toolCallId}
                    role="status"
                    className="mx-11 p-3 bg-green-50 border border-green-200 rounded-xl text-base text-green-900"
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
                    onComplete={isLatest ? (n) => onUploadComplete(part.toolCallId, n) : () => {}}
                    onSkip={isLatest ? () => onUploadSkip(part.toolCallId) : () => {}}
                  />
                );
              }
              if (part.state === "output-available") {
                return (
                  <div
                    key={part.toolCallId}
                    role="status"
                    className="mx-11 p-3 bg-green-50 border border-green-200 rounded-xl text-base text-green-900"
                  >
                    Documents submitted.
                  </div>
                );
              }
            }

            if (part.type === "tool-scheduleAppointment") {
              if (part.state === "input-available" || part.state === "input-streaming") {
                const isLatest = msgIndex === lastMsgIndex;
                return (
                  <CalendlyEmbed
                    key={part.toolCallId}
                    sessionId={part.input?.sessionId ?? sessionId}
                    prefillName={part.input?.prefillName ?? ""}
                    prefillEmail={part.input?.prefillEmail ?? ""}
                    matterDescription={part.input?.matterDescription ?? ""}
                    onBooked={
                      isLatest
                        ? (result) => onScheduleBooked(part.toolCallId, result)
                        : () => {}
                    }
                    disabled={!isLatest}
                  />
                );
              }
              if (part.state === "output-available") {
                return (
                  <div
                    key={part.toolCallId}
                    role="status"
                    className="mx-11 p-3 bg-green-50 border border-green-200 rounded-xl text-base text-green-900"
                  >
                    Session booked.
                  </div>
                );
              }
            }

            if (part.type === "tool-showUrgentContact") {
              if (part.state === "input-available" || part.state === "input-streaming") {
                const isLatest = msgIndex === lastMsgIndex;
                return (
                  <UrgentContactCard
                    key={part.toolCallId}
                    onAcknowledge={
                      isLatest ? () => onUrgentAcknowledged(part.toolCallId) : () => {}
                    }
                    disabled={!isLatest}
                  />
                );
              }
              if (part.state === "output-available") {
                return (
                  <div
                    key={part.toolCallId}
                    role="status"
                    className="mx-11 p-3 bg-green-50 border border-green-200 rounded-xl text-base text-green-900"
                  >
                    Thanks — we&apos;ll be ready for your call.
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
