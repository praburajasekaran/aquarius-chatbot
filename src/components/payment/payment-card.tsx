"use client";

import { useCallback, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from "@stripe/react-stripe-js";
import { CreditCard } from "lucide-react";

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
          <strong>
            {urgency === "urgent" ? "Urgent" : "Non-Urgent"} Criminal Matter
          </strong>{" "}
          — Legal Strategy Session
        </p>
        <p className="text-lg font-semibold text-gray-900 mt-1">
          {displayPrice}
        </p>
      </div>
      <p className="text-sm text-gray-700">
        In accordance with the Legal Profession Uniform Law, this is a fixed
        fee for an initial consultation. Further legal work will be quoted
        separately.
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
