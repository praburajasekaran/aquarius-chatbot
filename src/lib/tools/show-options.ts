import { tool } from "ai";
import { z } from "zod";

// Client-side rendered — no execute. Displays tappable quick-reply buttons.
export const showOptions = tool({
  description:
    "Display quick-reply buttons for the visitor to tap. Use this after answering a question or at any decision point where the visitor needs to choose a next step. Always provide 2–4 short, clear options.",
  inputSchema: z.object({
    options: z
      .array(z.string())
      .min(2)
      .max(4)
      .describe("The button labels to show, e.g. ['Yes, proceed', 'Ask another question']"),
  }),
  // No execute — rendered client-side
});
