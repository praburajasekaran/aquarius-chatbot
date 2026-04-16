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

// `lineItem` is the firm-prescribed payment description (do not paraphrase) —
// it flows to the BPoint/Stripe receipt and the Smokeball invoice line item
// for reconciliation. `tier` is the visitor-facing tier heading.
export const PRICING = {
  urgent: {
    amount: 132000, // $1,320.00 in cents
    tier: "Urgent Criminal Matter",
    lineItem: "Initial Deposit for Urgent Court Matter",
    displayPrice: "$1,320.00 (incl. GST)",
  },
  "non-urgent": {
    amount: 72600, // $726.00 in cents
    tier: "Non-Urgent Criminal Matter",
    lineItem: "Legal Strategy Session",
    displayPrice: "$726.00 (incl. GST)",
  },
} as const;

export type CheckoutUrgency = keyof typeof PRICING;

export interface CreateCheckoutSessionArgs {
  sessionId: string;
  urgency: CheckoutUrgency;
  customerEmail?: string;
  returnUrlBase: string;
  uiMode?: "embedded_page" | "hosted_page" | "elements" | "form";
}

export async function createCheckoutSession(args: CreateCheckoutSessionArgs) {
  const pricing = PRICING[args.urgency];
  return getStripe().checkout.sessions.create({
    mode: "payment",
    currency: "aud",
    line_items: [
      {
        price_data: {
          currency: "aud",
          unit_amount: pricing.amount,
          product_data: { name: pricing.lineItem },
        },
        quantity: 1,
      },
    ],
    ui_mode: args.uiMode ?? "embedded_page",
    redirect_on_completion: "if_required",
    return_url: `${args.returnUrlBase}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    metadata: { sessionId: args.sessionId, urgency: args.urgency },
    customer_email: args.customerEmail,
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
  });
}
