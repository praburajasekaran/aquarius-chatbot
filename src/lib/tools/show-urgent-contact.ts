import { tool } from "ai";
import { z } from "zod";

export const showUrgentContact = tool({
  description:
    "Present the firm's phone number and business hours to an urgent-matter visitor. Call this only after uploadDocuments completes AND when the earlier selectUrgency choice was 'urgent'. Never call for non-urgent matters.",
  inputSchema: z.object({
    sessionId: z.string().describe("The chat session ID"),
  }),
  outputSchema: z.object({
    acknowledged: z.boolean(),
  }),
});
