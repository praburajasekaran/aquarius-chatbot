import { tool } from "ai";
import { z } from "zod";

// This tool has no execute — it renders a client-side payment UI.
// Pricing is intentionally NOT part of the schema: the canonical urgency and
// amount are stored in Redis (by selectUrgency) and fetched server-side by the
// checkout endpoint and the PaymentCard. This prevents the model from passing
// a wrong tier and causing silent misbilling.
export const initiatePayment = tool({
  description:
    "Initiate Stripe Checkout using the urgency the visitor already confirmed in selectUrgency. This renders a payment form on the client side. The pricing is looked up server-side from the intake record — do NOT pass urgency, amount, or displayPrice.",
  inputSchema: z.object({
    sessionId: z.string().describe("The chat session ID"),
  }),
  outputSchema: z.object({
    status: z.enum(["completed"]).describe("Payment completion status"),
  }),
  // No execute — this is a client-side rendered tool
});
