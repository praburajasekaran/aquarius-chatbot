import { tool } from "ai";
import { z } from "zod";

// This tool has no execute — it renders a client-side payment UI
export const initiatePayment = tool({
  description:
    "Initiate BPoint checkout for the appropriate tier — Legal Strategy Session (non-urgent) or Initial Deposit for Urgent Court Matter (urgent). This renders a payment form on the client side. Use this after the visitor has confirmed their urgency selection and reviewed the cost disclosure.",
  inputSchema: z.object({
    sessionId: z.string().describe("The chat session ID"),
    urgency: z
      .enum(["urgent", "non-urgent"])
      .describe("The selected urgency level"),
    amount: z.number().describe("The payment amount in cents"),
    displayPrice: z.string().describe("The formatted display price"),
  }),
  outputSchema: z.object({
    status: z.enum(["completed"]).describe("Payment completion status"),
  }),
  // No execute — this is a client-side rendered tool
});
