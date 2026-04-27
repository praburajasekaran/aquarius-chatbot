"use client";

import { useCallback, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from "@stripe/react-stripe-js";
import { CheckCircle2, CreditCard } from "lucide-react";
import { PRICING } from "@/lib/stripe";

// Demo bypass: while Bpoint Checkout is being enabled, allow client demos to
// skip the real payment step. Remove this flag (and the bypass branch below)
// once Bpoint is live.
const DEMO_BYPASS_PAYMENT =
  process.env.NEXT_PUBLIC_DEMO_BYPASS_PAYMENT === "true";

// loadStripe must live outside the component so the Stripe object isn't
// recreated on every render.
const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""
);

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
  const [error, setError] = useState<string | null>(null);

  const fetchClientSecret = useCallback(async () => {
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, urgency }),
    });
    if (!res.ok) {
      setError("We couldn't start the checkout. Please try again.");
      throw new Error("Failed to create checkout session");
    }
    const { clientSecret } = await res.json();
    return clientSecret as string;
  }, [sessionId, urgency]);

  if (DEMO_BYPASS_PAYMENT) {
    return (
      <DemoPaymentCard
        urgency={urgency}
        displayPrice={displayPrice}
        onComplete={onComplete}
      />
    );
  }

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
        <p className="text-lg font-semibold text-gray-900 mt-1">
          {displayPrice}
        </p>
      </div>
      <p className="text-sm text-gray-700">
        {urgency === "urgent"
          ? "In accordance with the Legal Profession Uniform Law, this is a fixed initial deposit to commence work on your urgent matter. Further legal work will be quoted separately."
          : "In accordance with the Legal Profession Uniform Law, this is a fixed fee for an initial consultation. Further legal work will be quoted separately."}
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}
      <div className="rounded-lg overflow-hidden border border-gray-200">
        <EmbeddedCheckoutProvider
          stripe={stripePromise}
          options={{ fetchClientSecret, onComplete }}
        >
          <EmbeddedCheckout />
        </EmbeddedCheckoutProvider>
      </div>
    </section>
  );
}

function DemoPaymentCard({
  urgency,
  displayPrice,
  onComplete,
}: {
  urgency: "urgent" | "non-urgent";
  displayPrice: string;
  onComplete: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "processing" | "succeeded">(
    "idle"
  );

  function handlePay() {
    setStatus("processing");
    // Brief delay so the demo feels like a real checkout round-trip.
    setTimeout(() => {
      setStatus("succeeded");
      onComplete();
    }, 800);
  }

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
        <p className="text-lg font-semibold text-gray-900 mt-1">
          {displayPrice}
        </p>
      </div>
      <p className="text-sm text-gray-700">
        {urgency === "urgent"
          ? "In accordance with the Legal Profession Uniform Law, this is a fixed initial deposit to commence work on your urgent matter. Further legal work will be quoted separately."
          : "In accordance with the Legal Profession Uniform Law, this is a fixed fee for an initial consultation. Further legal work will be quoted separately."}
      </p>
      <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
        Demo mode — no real payment will be processed.
      </p>
      {status === "succeeded" ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-900"
        >
          <CheckCircle2 className="h-4 w-4 text-green-700" aria-hidden="true" />
          Payment successful.
        </div>
      ) : (
        <button
          type="button"
          onClick={handlePay}
          disabled={status === "processing"}
          className="w-full rounded-lg bg-brand px-4 py-2.5 text-base font-medium text-white shadow-sm transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {status === "processing"
            ? "Processing…"
            : `Pay ${displayPrice} (Demo)`}
        </button>
      )}
    </section>
  );
}
