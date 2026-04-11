import { tool } from "ai";
import { z } from "zod";

// Renders quick-reply buttons client-side. No execute — stream halts here so
// the AI waits for the user's selection before continuing.
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
  outputSchema: z.object({
    selected: z.string().describe("The option the visitor chose"),
  }),
});
