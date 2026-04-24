"use client";

import { useCallback, useEffect, useState } from "react";
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
  onComplete: () => void;
}

interface Pricing {
  urgency: "urgent" | "non-urgent";
  displayPrice: string;
  tier: string;
  lineItem: string;
}

export function PaymentCard({ sessionId, onComplete }: PaymentCardProps) {
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/intake/${encodeURIComponent(sessionId)}/pricing`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`pricing lookup failed (${res.status})`);
        return res.json() as Promise<Pricing>;
      })
      .then((data) => {
        if (!cancelled) setPricing(data);
      })
      .catch((err) => {
        console.error("[PaymentCard] pricing lookup failed", err);
        if (!cancelled) {
          setError(
            "We couldn't load your payment details. Please refresh and try again."
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const fetchClientSecret = useCallback(async () => {
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    if (!res.ok) {
      setError("We couldn't start the checkout. Please try again.");
      throw new Error("Failed to create checkout session");
    }
    const { clientSecret } = await res.json();
    return clientSecret as string;
  }, [sessionId]);

  if (error && !pricing) {
    return (
      <section
        aria-label="Payment unavailable"
        className="mx-11 p-4 bg-white border border-red-200 rounded-xl shadow-sm"
      >
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      </section>
    );
  }

  if (!pricing) {
    return (
      <section
        aria-label="Loading payment"
        className="mx-11 p-4 bg-white border border-gray-200 rounded-xl shadow-sm"
      >
        <p className="text-sm text-gray-600">Loading payment details…</p>
      </section>
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
          <strong>{pricing.tier}</strong> — {pricing.lineItem}
        </p>
        <p className="text-lg font-semibold text-gray-900 mt-1">
          {pricing.displayPrice}
        </p>
      </div>
      <p className="text-sm text-gray-700">
        {pricing.urgency === "urgent"
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
