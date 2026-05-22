"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import { User } from "lucide-react";
import type { ChatMessage } from "@/lib/tools";
import { PaymentCard } from "@/components/payment/payment-card";
import { DocumentUpload } from "@/components/upload/document-upload";
import { CalendlyEmbed } from "@/components/booking/calendly-embed";
import { UrgentContactCard } from "@/components/booking/urgent-contact-card";
import { BRANDING } from "@/lib/branding";
import { sanitizeAssistantText } from "@/lib/sanitize-llm-text";

const PAYMENT_CONFIRM_OPTIONS = [
  "Yes, please proceed",
  "No, I don't want to proceed",
];

interface MessageListProps {
  messages: ChatMessage[];
  sessionId: string;
  onPaymentComplete: (toolCallId: string) => void;
  onPaymentFail: (toolCallId: string) => void;
  onUploadComplete: (toolCallId: string, uploaded: number) => void;
  onUploadSkip: (toolCallId: string) => void;
  onScheduleBooked: (
    toolCallId: string,
    result: { eventStartTime: string; eventUri: string; inviteeUri: string }
  ) => void;
  onUrgentAcknowledged: (toolCallId: string) => void;
  onMandatoryOptionPick: (text: string) => void;
}

// Walk forward from the assistant turn at `fromIndex` to find the first
// subsequent user message. If its concatenated text matches one of the
// chip options exactly, return that option — chip clicks send the label
// verbatim, so an exact match means "this option was chosen". Returns
// null when the visitor hasn't replied yet, or replied with free-form
// text that didn't match any chip.
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

function messageText(message: ChatMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => sanitizeAssistantText(p.text).trim())
    .filter(Boolean)
    .join("\n\n");
}

function hasMandatoryShowOptions(message: ChatMessage): boolean {
  return message.parts.some(
    (part) =>
      part.type === "tool-showOptions" &&
      part.input?.mandatory === true &&
      (part.state === "input-available" || part.state === "output-available"),
  );
}

function needsPaymentConfirmFallback(message: ChatMessage): boolean {
  if (message.role !== "assistant" || hasMandatoryShowOptions(message)) {
    return false;
  }
  return /do you want to proceed with this booking\?/i.test(messageText(message));
}

function MandatoryOptionButtons({
  options,
  selectedOption,
  canInteract,
  onPick,
}: {
  options: string[];
  selectedOption: string | null;
  canInteract: boolean;
  onPick: (text: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Quick reply options"
      className="flex flex-wrap gap-2 pl-11"
    >
      {options.map((option: string) => {
        const isSelected = option === selectedOption;
        const stateClasses = canInteract
          ? "border-[#085a66] text-[#085a66] hover:bg-[#085a66] hover:text-white cursor-pointer"
          : isSelected
          ? "border-[#085a66] bg-[#085a66] text-white cursor-default"
          : "border-gray-300 text-gray-500 cursor-default";
        return (
          <button
            key={option}
            type="button"
            onClick={() => canInteract && onPick(option)}
            disabled={!canInteract}
            aria-pressed={isSelected || undefined}
            /* min-h-[44px] satisfies WCAG 2.5.5 AAA 44x44px touch target */
            className={`px-4 min-h-[44px] rounded-full border text-base font-medium transition-colors ${stateClasses}`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

export function MessageList({
  messages,
  sessionId,
  onPaymentComplete,
  onPaymentFail,
  onUploadComplete,
  onUploadSkip,
  onScheduleBooked,
  onUrgentAcknowledged,
  onMandatoryOptionPick,
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

  const lastMsgIndex = messages.length - 1;

  // Models with parallel tool calls (Gemini 2.5 Flash, Haiku 4.5) sometimes
  // emit the same client-pausing tool more than once. The visible card must
  // stay stable across user-side resolutions: `addToolOutput` mutates only
  // the resolved part to output-available, so a "latest pending" rule causes
  // an earlier still-pending duplicate to un-suppress and render a fresh
  // widget right after the visible one is acknowledged. Pick the FIRST
  // pending toolCallId per type and keep it for the rest of the transcript.
  // Once any instance of a type has resolved (output-available/error),
  // suppress every other pending instance — the conversation is past it.
  const renderedToolCallIdByType: Record<string, string | null> = {
    "tool-initiatePayment": null,
    "tool-uploadDocuments": null,
    "tool-scheduleAppointment": null,
    "tool-showUrgentContact": null,
  };
  const resolvedToolTypes = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const p of message.parts) {
      const part = p as { type?: string; state?: string; toolCallId?: string };
      if (typeof part.type !== "string") continue;
      if (!(part.type in renderedToolCallIdByType)) continue;
      if (typeof part.toolCallId !== "string") continue;
      if (part.state === "output-available" || part.state === "output-error") {
        resolvedToolTypes.add(part.type);
        continue;
      }
      if (part.state !== "input-available" && part.state !== "input-streaming") continue;
      if (renderedToolCallIdByType[part.type] === null) {
        renderedToolCallIdByType[part.type] = part.toolCallId;
      }
    }
  }

  // Static welcome bubble. Rendered as a sibling of the message list (not
  // injected into `messages`) so it persists across the conversation without
  // ever being sent to the model — purely a UI affordance that greets the
  // visitor first instead of an empty canvas.
  const welcomeBubble = (
    <div className="flex gap-3">
      <div
        aria-hidden="true"
        className="shrink-0 h-8 w-8 rounded-xl overflow-hidden bg-brand/10"
      >
        <Image
          src="/banjo.png"
          alt=""
          width={64}
          height={64}
          className="h-full w-full object-cover"
        />
      </div>
      <div
        aria-label={`Assistant: ${BRANDING.welcomeMessage}`}
        className="max-w-[80%] rounded-2xl px-4 py-2.5 text-base leading-relaxed bg-gray-100 text-gray-800 rounded-bl-md whitespace-pre-line"
      >
        {BRANDING.welcomeMessage}
      </div>
    </div>
  );

  return (
    /* role="log" has implicit aria-live="polite" — new messages announced to screen readers */
    <div ref={scrollRef} role="log" aria-label="Conversation" className="flex-1 overflow-y-auto p-4 space-y-4">
      {welcomeBubble}
      {messages.map((message, msgIndex) => {
        const fallbackPaymentConfirm = needsPaymentConfirmFallback(message);
        const fallbackSelectedOption = fallbackPaymentConfirm
          ? findNextUserMessageMatching(messages, msgIndex, PAYMENT_CONFIRM_OPTIONS)
          : null;
        const fallbackCanInteract =
          fallbackPaymentConfirm &&
          msgIndex === lastMsgIndex &&
          fallbackSelectedOption === null;

        return (
        <div key={message.id} className="space-y-2">
          {message.parts.map((part, i) => {
            if (part.type === "text" && part.text) {
              const isUser = message.role === "user";
              const displayText = isUser
                ? part.text
                : sanitizeAssistantText(part.text);
              if (!displayText.trim()) return null;
              return (
                <div
                  key={`${message.id}-${i}`}
                  className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}
                >
                  {/* Avatar — decorative, hidden from AT */}
                  <div
                    aria-hidden="true"
                    className={`shrink-0 h-8 w-8 rounded-xl overflow-hidden ${
                      isUser ? "bg-gray-200 flex items-center justify-center" : "bg-brand/10"
                    }`}
                  >
                    {isUser ? (
                      <User className="h-4 w-4 text-gray-600" />
                    ) : (
                      <Image
                        src="/banjo.png"
                        alt=""
                        width={64}
                        height={64}
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <div
                    aria-label={`${isUser ? "You" : "Assistant"}: ${displayText}`}
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-base leading-relaxed ${
                      isUser
                        ? "bg-[#085a66] text-white rounded-br-md"
                        : "bg-gray-100 text-gray-800 rounded-bl-md"
                    }`}
                  >
                    {isUser ? (
                      displayText
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
                          {displayText}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            // Mandatory quick-reply chips — rendered in-thread under the
            // assistant bubble as large pill buttons. Three visual states:
            //   • interactive (latest, unanswered)  → outlined teal, hoverable
            //   • selected (next user message matched an option) → filled teal
            //   • historical or not-latest          → muted, disabled
            // Optional (mandatory !== true) showOptions calls fall through and
            // render in the composer "Quick reply" row instead.
            if (
              part.type === "tool-showOptions" &&
              part.input?.mandatory === true &&
              (part.state === "input-available" || part.state === "output-available")
            ) {
              const options = part.input.options ?? [];
              const selectedOption = findNextUserMessageMatching(
                messages,
                msgIndex,
                options
              );
              const isLatest = msgIndex === lastMsgIndex;
              const isAnswered = selectedOption !== null;
              const canInteract = isLatest && !isAnswered;
              return (
                <MandatoryOptionButtons
                  key={part.toolCallId}
                  options={options}
                  selectedOption={selectedOption}
                  canInteract={canInteract}
                  onPick={onMandatoryOptionPick}
                />
              );
            }

            // Payment tool
            if (part.type === "tool-initiatePayment") {
              if (part.state === "input-available") {
                if (
                  resolvedToolTypes.has("tool-initiatePayment") ||
                  renderedToolCallIdByType["tool-initiatePayment"] !== part.toolCallId
                ) {
                  return null;
                }
                const isLatest = msgIndex === lastMsgIndex;
                return (
                  <PaymentCard
                    key={part.toolCallId}
                    sessionId={part.input?.sessionId ?? sessionId}
                    onComplete={isLatest ? () => onPaymentComplete(part.toolCallId) : () => {}}
                    onFail={isLatest ? () => onPaymentFail(part.toolCallId) : undefined}
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
                if (
                  resolvedToolTypes.has("tool-uploadDocuments") ||
                  renderedToolCallIdByType["tool-uploadDocuments"] !== part.toolCallId
                ) {
                  return null;
                }
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
                if (
                  resolvedToolTypes.has("tool-scheduleAppointment") ||
                  renderedToolCallIdByType["tool-scheduleAppointment"] !== part.toolCallId
                ) {
                  return null;
                }
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
                if (
                  resolvedToolTypes.has("tool-showUrgentContact") ||
                  renderedToolCallIdByType["tool-showUrgentContact"] !== part.toolCallId
                ) {
                  return null;
                }
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
          {fallbackPaymentConfirm && (
            <MandatoryOptionButtons
              options={PAYMENT_CONFIRM_OPTIONS}
              selectedOption={fallbackSelectedOption}
              canInteract={fallbackCanInteract}
              onPick={onMandatoryOptionPick}
            />
          )}
        </div>
        );
      })}
    </div>
  );
}
