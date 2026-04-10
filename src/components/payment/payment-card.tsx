"use client";

import { useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";

interface PaymentCardProps {
  sessionId: string;
  urgency: "urgent" | "non-urgent";
  displayPrice: string;
  onComplete: () => void;
}

export function PaymentCard({
  sessionId,
  urgency,
  displayPrice,
  onComplete,
}: PaymentCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePay() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, urgency }),
      });

      if (!res.ok) {
        throw new Error("Failed to create checkout session");
      }

      const { clientSecret } = await res.json();

      // TODO: Mount embedded Stripe Checkout with clientSecret
      // For now, log and simulate success
      console.log("Stripe client secret:", clientSecret);
      onComplete();
    } catch {
      setError("Payment failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-11 p-4 bg-white border border-gray-200 rounded-xl shadow-sm space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
        <CreditCard className="h-4 w-4 text-brand" />
        Payment Required
      </div>
      <div className="text-sm text-gray-600">
        <p>
          <strong>
            {urgency === "urgent" ? "Urgent" : "Non-Urgent"} Criminal Matter
          </strong>{" "}
          — Legal Strategy Session
        </p>
        <p className="text-lg font-semibold text-gray-900 mt-1">
          {displayPrice}
        </p>
      </div>
      <p className="text-xs text-gray-500">
        In accordance with the Legal Profession Uniform Law, this is a fixed fee
        for an initial consultation. Further legal work will be quoted
        separately.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        onClick={handlePay}
        disabled={loading}
        className="w-full py-2.5 px-4 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-dark transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Processing...
          </>
        ) : (
          <>
            <CreditCard className="h-4 w-4" />
            Pay {displayPrice}
          </>
        )}
      </button>
    </div>
  );
}
