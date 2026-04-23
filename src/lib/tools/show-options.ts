import { tool } from "ai";
import { z } from "zod";

// Renders suggestion chips client-side. Has an execute function that
// auto-resolves so the AI stream never halts — the chips are purely
// optional shortcuts. The user may click a chip (which sends the text as
// a normal user message) or ignore them entirely and type freely.
export const showOptions = tool({
  description:
    "Display optional suggestion chips for the visitor. Use SPARINGLY — only at clear action points (book a session, proceed to payment, urgent escalation) or for tightly scoped yes/no questions. For open-ended information gathering, ask conversationally and let the visitor type freely. Do not use after every response. Always provide 2–4 short, clear options when used.",
  inputSchema: z.object({
    options: z
      .array(z.string())
      .min(2)
      .max(4)
      .describe("The chip labels to show, e.g. ['Yes, proceed', 'Ask another question']"),
  }),
  execute: async () => {
    // Auto-resolves immediately. The chips are purely UI — the AI does not
    // wait for a selection. When the user sends a message (via chip click
    // or free-form typing), the AI responds to that message naturally.
    return { acknowledged: true } as const;
  },
});
