import Stripe from "stripe";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { typescript: true });
  }
  return _stripe;
}

export const PRICING = {
  urgent: {
    amount: 132000, // $1,320.00 in cents
    label: "Urgent Criminal Matter — Legal Strategy Session",
    displayPrice: "$1,320.00 (incl. GST)",
  },
  "non-urgent": {
    amount: 72600, // $726.00 in cents
    label: "Non-Urgent Criminal Matter — Legal Strategy Session",
    displayPrice: "$726.00 (incl. GST)",
  },
} as const;
