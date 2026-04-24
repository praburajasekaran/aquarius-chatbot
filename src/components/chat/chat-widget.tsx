"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { useRef, useEffect, useMemo, useState } from "react";
import { DisclaimerBanner } from "./disclaimer-banner";
import { MessageList } from "./message-list";
import { MessageInput } from "./message-input";
import type { ChatMessage } from "@/lib/tools";
import type { PaymentFailureReason } from "@/components/payment/payment-card";

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

  const [paymentFailureReason, setPaymentFailureReason] =
    useState<PaymentFailureReason | undefined>(undefined);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Read ?payment= URL param once on mount. The confirm route redirects back
  // to /?payment=success or /?payment=failed&reason=... after BPoint posts
  // ResultKey server-to-server. We translate that into chat state and then
  // clear the URL so a refresh doesn't re-trigger.
  //
  // Strategy B toolCallId resolution: handlePaymentComplete calls
  // addToolOutput({ tool, toolCallId, output }) from @ai-sdk/react — passing
  // an empty toolCallId would silently fail to advance the chat because the
  // AI never receives the tool result. We scan `messages` for the most
  // recent tool-initiatePayment part and use its toolCallId. If none is
  // found, fall back to "" (Strategy A behaviour) — never crash.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const payment = params.get("payment");
    const reason = params.get("reason");

    if (payment === "success") {
      let latestPaymentToolCallId = "";
      for (let mi = messages.length - 1; mi >= 0; mi--) {
        const parts = messages[mi]?.parts ?? [];
        for (let pi = parts.length - 1; pi >= 0; pi--) {
          const part = parts[pi] as { type?: string; toolCallId?: string };
          if (part?.type === "tool-initiatePayment" && part.toolCallId) {
            latestPaymentToolCallId = part.toolCallId;
            break;
          }
        }
        if (latestPaymentToolCallId) break;
      }
      handlePaymentComplete(latestPaymentToolCallId);
      window.history.replaceState({}, "", window.location.pathname);
    } else if (payment === "failed") {
      const validReasons: PaymentFailureReason[] = ["declined", "invalid", "system", "expired"];
      const r = (reason ?? "system") as PaymentFailureReason;
      setPaymentFailureReason(validReasons.includes(r) ? r : "system");
      window.history.replaceState({}, "", window.location.pathname);
    }
    // Run only on first mount — URL is processed once per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRetryRequested = () => setPaymentFailureReason(undefined);

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
        onOptionSelect={(toolCallId, text) =>
          addToolOutput({ tool: "showOptions", toolCallId, output: { selected: text } })
        }
        onPaymentComplete={handlePaymentComplete}
        onUploadComplete={handleUploadComplete}
        onUploadSkip={handleUploadSkip}
        onScheduleBooked={handleScheduleBooked}
        onUrgentAcknowledged={handleUrgentAcknowledged}
        failureReason={paymentFailureReason}
        onRetryRequested={handleRetryRequested}
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
