import { tool } from "ai";
import { z } from "zod";
import { validateEmail, validatePhone } from "@/lib/validators";

export const collectDetails = tool({
  description:
    "Collect and validate client contact details. Use this tool after answering the visitor's questions, when they are ready to proceed with a Legal Strategy Session. Validate email and Australian phone number formats.",
  inputSchema: z.object({
    name: z.string().describe("Client's full name"),
    email: z.string().describe("Client's email address"),
    phone: z.string().describe("Client's phone number (Australian format)"),
    matterDescription: z
      .string()
      .describe("Brief description of the criminal matter"),
  }),
  execute: async ({ name, email, phone, matterDescription }) => {
    const errors: string[] = [];

    if (!name.trim() || name.trim().length < 2) {
      errors.push("Please provide your full name.");
    }

    if (!validateEmail(email)) {
      errors.push(
        "Please provide a valid email address (e.g., name@example.com)."
      );
    }

    if (!validatePhone(phone)) {
      errors.push(
        "Please provide a valid Australian phone number (e.g., 0412 345 678 or 02 1234 5678)."
      );
    }

    if (!matterDescription.trim() || matterDescription.trim().length < 2) {
      errors.push(
        "Please provide a brief description of your matter."
      );
    }

    if (errors.length > 0) {
      return {
        valid: false,
        errors,
      };
    }

    return {
      valid: true,
      details: {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        matterDescription: matterDescription.trim(),
      },
    };
  },
});
