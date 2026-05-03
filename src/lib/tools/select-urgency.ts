import { tool } from "ai";
import { z } from "zod";
import { PRICING } from "@/lib/stripe";
import { createIntake } from "@/lib/intake";
import { sendClientInquiryEmail, sendFirmLeadEmail } from "@/lib/resend";
import { validateEmail, validatePhone } from "@/lib/validators";

// Defense-in-depth caps. The model can pass arbitrary strings here (it's a
// tool call, not a server-validated form) so we re-validate before any of
// these values flow into Resend / Zapier / Smokeball / SMS.
const MAX_NAME_LENGTH = 200;
const MAX_MATTER_LENGTH = 2000;

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
    const trimmedName = clientName.trim();
    const trimmedEmail = clientEmail.trim();
    const trimmedPhone = clientPhone.trim();
    const trimmedMatter = matterDescription.trim();

    const errors: string[] = [];
    if (trimmedName.length < 2 || trimmedName.length > MAX_NAME_LENGTH) {
      errors.push("clientName must be 2-200 characters.");
    }
    if (!validateEmail(trimmedEmail)) {
      errors.push("clientEmail is not a valid email address.");
    }
    if (!validatePhone(trimmedPhone)) {
      errors.push("clientPhone is not a valid Australian phone number.");
    }
    if (trimmedMatter.length < 2 || trimmedMatter.length > MAX_MATTER_LENGTH) {
      errors.push("matterDescription must be 2-2000 characters.");
    }

    if (errors.length > 0) {
      return {
        ok: false,
        error: "invalid_arguments",
        details: errors,
        message:
          "I couldn't record that — please re-confirm your name, email, phone, and matter details.",
      } as const;
    }

    const pricing = PRICING[urgency];

    try {
      await createIntake({
        sessionId,
        clientName: trimmedName,
        clientEmail: trimmedEmail,
        clientPhone: trimmedPhone,
        matterDescription: trimmedMatter,
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
        clientName: trimmedName,
        clientEmail: trimmedEmail,
        matterDescription: trimmedMatter,
        urgency,
        displayPrice: pricing.displayPrice,
      });
    } catch (err) {
      console.error("[selectUrgency] failed to send client inquiry email", err);
    }

    const appUrl = process.env.NEXT_PUBLIC_URL ?? "";
    const resumeUrl = `${appUrl}/api/checkout/resume?session=${encodeURIComponent(sessionId)}`;
    try {
      await sendFirmLeadEmail({
        clientName: trimmedName,
        clientEmail: trimmedEmail,
        clientPhone: trimmedPhone,
        matterDescription: trimmedMatter,
        urgency,
        displayPrice: pricing.displayPrice,
        resumeUrl,
      });
    } catch (err) {
      console.error("[selectUrgency] failed to send firm lead email", err);
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
