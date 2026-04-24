import { tool } from "ai";
import { z } from "zod";
import { PRICING } from "@/lib/pricing";
import { createIntake } from "@/lib/intake";
import { sendClientInquiryEmail } from "@/lib/resend";

export const selectUrgency = tool({
  description:
    "Record the visitor's urgency selection, persist inquiry details for the 7-day intake window, and send them a client confirmation email. Use this after collecting details. The visitor chooses between an urgent matter ($1,320 incl. GST — Initial Deposit for Urgent Court Matter) or a non-urgent matter ($726 incl. GST — Legal Strategy Session).",
  inputSchema: z.object({
    sessionId: z.string().describe("The chat session ID"),
    urgency: z
      .enum(["urgent", "non-urgent"])
      .describe("The urgency level selected by the visitor"),
    clientName: z.string().describe("Client's full name from collectDetails"),
    clientEmail: z.string().describe("Client's email from collectDetails"),
    clientPhone: z.string().describe("Client's phone from collectDetails"),
    matterDescription: z
      .string()
      .describe("Matter description from collectDetails"),
  }),
  execute: async ({
    sessionId,
    urgency,
    clientName,
    clientEmail,
    clientPhone,
    matterDescription,
  }) => {
    const pricing = PRICING[urgency];

    try {
      await createIntake({
        sessionId,
        clientName,
        clientEmail,
        clientPhone,
        matterDescription,
        urgency,
        displayPrice: pricing.displayPrice,
        amountCents: pricing.amount,
      });
    } catch (err) {
      console.error("[selectUrgency] failed to create intake record", err);
    }

    try {
      await sendClientInquiryEmail({
        sessionId,
        clientName,
        clientEmail,
        matterDescription,
        urgency,
        displayPrice: pricing.displayPrice,
      });
    } catch (err) {
      console.error("[selectUrgency] failed to send client inquiry email", err);
    }

    const costDisclosure =
      urgency === "urgent"
        ? "In accordance with the Legal Profession Uniform Law, the Initial Deposit for an Urgent Court Matter is a fixed amount. " +
          `The total cost is ${pricing.displayPrice}. ` +
          "This deposit covers initial work to commence acting on your urgent matter. " +
          "Any further legal work will be quoted separately."
        : "In accordance with the Legal Profession Uniform Law, the fee for a Legal Strategy Session is a fixed fee. " +
          `The total cost is ${pricing.displayPrice}. ` +
          "This covers an initial consultation to assess your matter and provide a strategy. " +
          "Any further legal work will be quoted separately.";

    return {
      urgency,
      amount: pricing.amount,
      displayPrice: pricing.displayPrice,
      tier: pricing.tier,
      lineItem: pricing.lineItem,
      costDisclosure,
    };
  },
});
