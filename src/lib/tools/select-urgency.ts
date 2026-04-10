import { tool } from "ai";
import { z } from "zod";
import { PRICING } from "@/lib/stripe";

export const selectUrgency = tool({
  description:
    "Present urgency options with pricing to the visitor. Use this after collecting their details. The visitor chooses between an urgent ($1,320 incl. GST) or non-urgent ($726 incl. GST) Legal Strategy Session.",
  inputSchema: z.object({
    urgency: z
      .enum(["urgent", "non-urgent"])
      .describe("The urgency level selected by the visitor"),
  }),
  execute: async ({ urgency }) => {
    const pricing = PRICING[urgency];

    return {
      urgency,
      amount: pricing.amount,
      displayPrice: pricing.displayPrice,
      label: pricing.label,
      costDisclosure:
        "In accordance with the Legal Profession Uniform Law, the fee for a Legal Strategy Session is a fixed fee. " +
        `The total cost for your ${urgency} matter is ${pricing.displayPrice}. ` +
        "This covers an initial consultation to assess your matter and provide a strategy. " +
        "Any further legal work will be quoted separately.",
    };
  },
});
