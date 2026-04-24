"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, RefreshCw, AlertTriangle } from "lucide-react";
import { PRICING } from "@/lib/pricing";

export type PaymentFailureReason = "declined" | "invalid" | "system" | "expired";

export interface PaymentCardProps {
  sessionId: string;
  urgency: "urgent" | "non-urgent";
  displayPrice: string;
  onComplete: () => void;
  failureReason?: PaymentFailureReason;
  onRetryRequested?: () => void;
}

type Status = "loading" | "ready" | "error" | "expired" | "declined" | "invalid" | "system";

const FAILURE_COPY: Record<PaymentFailureReason, string> = {
  declined: "Card declined — please try another card.",
  invalid: "Invalid card details — please check and try again.",
  system: "Payment couldn't be processed right now — please try again in a moment.",
  expired: "Payment session expired",
};

function bpointIframeUrl(authKey: string): string {
  // Confirmed in 02-RESEARCH.md and 02-CONTEXT.md.
  return `https://www.bpoint.com.au/webapi/v2/txns/iframe/${authKey}`;
}

export function PaymentCard({
  sessionId,
  urgency,
  displayPrice,
  onComplete,
  failureReason,
  onRetryRequested,
}: PaymentCardProps) {
  const [authKey, setAuthKey] = useState<string | null>(null);
  // Failure-driven status takes precedence; otherwise loading → ready.
  const [status, setStatus] = useState<Status>(failureReason ?? "loading");

  // Mirror failureReason changes from parent (URL ?payment=failed&reason=...).
  useEffect(() => {
    if (failureReason) setStatus(failureReason);
  }, [failureReason]);

  // Fire onComplete only when the parent flips us into a success-equivalent
  // state. Today, that is via the URL ?payment=success path, which the
  // parent translates by NOT setting failureReason and instead triggering
  // its own onPaymentComplete dispatch. Kept as a no-op effect here so the
  // prop continues to be a contract.
  // (The actual onComplete invocation lives in chat-widget when
  //  ?payment=success is detected.)

  const fetchAuthKey = useCallback(async () => {
    setStatus("loading");
    setAuthKey(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, urgency }),
      });
      if (!res.ok) {
        setStatus("system");
        return;
      }
      const { authKey: key } = (await res.json()) as { authKey?: string };
      if (!key) {
        setStatus("system");
        return;
      }
      setAuthKey(key);
      setStatus("ready");
    } catch {
      setStatus("system");
    }
  }, [sessionId, urgency]);

  // Initial fetch on mount only when not in a failure state.
  useEffect(() => {
    if (!failureReason) {
      void fetchAuthKey();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStartAgain = useCallback(() => {
    // Let parent clear ?payment= URL state if it wants to.
    onRetryRequested?.();
    void fetchAuthKey();
  }, [fetchAuthKey, onRetryRequested]);

  // Suppress unused warning while keeping the contract.
  void onComplete;

  const isFailure =
    status === "expired" ||
    status === "declined" ||
    status === "invalid" ||
    status === "system" ||
    status === "error";

  return (
    <section
      aria-label="Payment required"
      className="mx-11 p-4 bg-white border border-gray-200 rounded-xl shadow-sm space-y-3"
    >
      <div className="flex items-center gap-2 text-base font-medium text-gray-800">
        <CreditCard className="h-4 w-4 text-brand" aria-hidden="true" />
        Payment Required
      </div>
      <div className="text-base text-gray-700">
        <p>
          <strong>{PRICING[urgency].tier}</strong> — {PRICING[urgency].lineItem}
        </p>
        <p className="text-lg font-semibold text-gray-900 mt-1">{displayPrice}</p>
      </div>
      <p className="text-sm text-gray-700">
        {urgency === "urgent"
          ? "In accordance with the Legal Profession Uniform Law, this is a fixed initial deposit to commence work on your urgent matter. Further legal work will be quoted separately."
          : "In accordance with the Legal Profession Uniform Law, this is a fixed fee for an initial consultation. Further legal work will be quoted separately."}
      </p>

      {isFailure && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <div className="space-y-2">
            <p>
              {status === "expired"
                ? FAILURE_COPY.expired
                : status === "declined"
                ? FAILURE_COPY.declined
                : status === "invalid"
                ? FAILURE_COPY.invalid
                : FAILURE_COPY.system}
            </p>
            <button
              type="button"
              onClick={handleStartAgain}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-brand text-white text-sm font-medium hover:bg-brand/90 min-h-[44px]"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Start again
            </button>
          </div>
        </div>
      )}

      {status === "loading" && (
        <div className="flex items-center justify-center p-8 text-sm text-gray-500">
          <RefreshCw className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
          Preparing secure payment…
        </div>
      )}

      {status === "ready" && authKey && (
        <div className="rounded-lg overflow-hidden border border-gray-200">
          <iframe
            src={bpointIframeUrl(authKey)}
            title="Secure card payment"
            className="w-full"
            style={{ minHeight: 420 }}
          />
        </div>
      )}
    </section>
  );
}
