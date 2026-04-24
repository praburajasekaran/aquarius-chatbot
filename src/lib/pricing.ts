// `lineItem` is the firm-prescribed payment description (do not paraphrase) --
// it flows to the BPoint receipt and the Smokeball invoice line item
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
