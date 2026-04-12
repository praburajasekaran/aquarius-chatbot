"use client";

import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { Bot, User } from "lucide-react";
import type { ChatMessage } from "@/lib/tools";
import { PaymentCard } from "@/components/payment/payment-card";
import { DocumentUpload } from "@/components/upload/document-upload";
import { CalendlyEmbed } from "@/components/booking/calendly-embed";
import { UrgentContactCard } from "@/components/booking/urgent-contact-card";

interface MessageListProps {
  messages: ChatMessage[];
  sessionId: string;
  onOptionSelect: (toolCallId: string, text: string) => void;
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
  onOptionSelect,
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
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-center text-gray-700">
        <div>
          <Bot className="h-12 w-12 mx-auto mb-3 text-brand/40" aria-hidden="true" />
          <p className="text-base">
            Welcome to Aquarius Lawyers. Ask me anything about criminal law.
          </p>
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

            // Quick-reply buttons — interactive only on the latest unanswered group.
            // After the user picks, that option stays filled (highlighted) so they can see what they chose.
            if (part.type === "tool-showOptions" && (part.state === "input-available" || part.state === "output-available")) {
              const isLatest = msgIndex === lastMsgIndex;
              const isAnswered = part.state === "output-available";
              const selectedOption = isAnswered ? part.output?.selected : null;
              const canInteract = isLatest && !isAnswered;
              return (
                <div
                  key={part.toolCallId}
                  role="group"
                  aria-label="Quick reply options"
                  className="flex flex-wrap gap-2 pl-11"
                >
                  {part.input?.options?.map((option: string) => {
                    const isSelected = option === selectedOption;
                    /* Three visual states:
                       1. canInteract → outlined teal, hoverable (active choice)
                       2. isSelected  → filled teal, white text (your pick — AAA 7.88:1)
                       3. otherwise   → muted gray (historical, not chosen) */
                    const stateClasses = canInteract
                      ? "border-[#085a66] text-[#085a66] hover:bg-[#085a66] hover:text-white cursor-pointer"
                      : isSelected
                      ? "border-[#085a66] bg-[#085a66] text-white cursor-default"
                      : "border-gray-300 text-gray-500 cursor-default";
                    return (
                      <button
                        key={option}
                        onClick={() => canInteract && onOptionSelect(part.toolCallId, option)}
                        disabled={!canInteract}
                        aria-pressed={isSelected || undefined}
                        /* min-h-[44px] satisfies WCAG 2.5.5 AAA 44×44px touch target */
                        className={`px-4 min-h-[44px] rounded-full border text-base font-medium transition-colors ${stateClasses}`}
                      >
                        {option}
                      </button>
                    );
                  })}
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
