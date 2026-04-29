import { tool } from "ai";
import { z } from "zod";

// Renders suggestion chips client-side. Has an execute function that
// auto-resolves so the AI stream never halts — the chips are purely
// optional shortcuts. The user may click a chip (which sends the text as
// a normal user message) or ignore them entirely and type freely.
export const showOptions = tool({
  description:
    "Display suggestion chips for the visitor. Use SPARINGLY — only at clear action points (book a session, proceed to payment, urgent escalation) or for tightly scoped yes/no questions. For open-ended information gathering, ask conversationally and let the visitor type freely. Do not use after every response. Always provide 2–4 short, clear options when used. " +
    "Set `mandatory: true` ONLY for gating decisions where the visitor must pick one of the listed options to advance the flow (urgency selection, payment Yes/No). Mandatory chips render as large in-thread pills under the assistant bubble; default chips render as a compact suggestion row above the composer.",
  inputSchema: z.object({
    options: z
      .array(z.string())
      .min(2)
      .max(4)
      .describe("The chip labels to show, e.g. ['Yes, proceed', 'Ask another question']"),
    mandatory: z
      .boolean()
      .optional()
      .describe(
        "When true, chips render in-thread as large pill buttons (gating decision the visitor must pick). When false/omitted, chips render as a small composer suggestion row (optional shortcut)."
      ),
  }),
  execute: async () => {
    // Auto-resolves immediately. The chips are purely UI — the AI does not
    // wait for a selection. When the user sends a message (via chip click
    // or free-form typing), the AI responds to that message naturally.
    return { acknowledged: true } as const;
  },
});
