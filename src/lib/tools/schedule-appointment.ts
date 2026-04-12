import { tool } from "ai";
import { z } from "zod";

export const scheduleAppointment = tool({
  description:
    "Present an inline Calendly booking widget so the visitor can pick a slot for their non-urgent Legal Strategy Session. Call this only after uploadDocuments completes AND when the earlier selectUrgency choice was 'non-urgent'. Never call for urgent matters.",
  inputSchema: z.object({
    sessionId: z.string().describe("The chat session ID"),
    prefillName: z.string().describe("Client's full name from collectDetails"),
    prefillEmail: z.string().describe("Client's email from collectDetails"),
    matterDescription: z
      .string()
      .describe("Brief matter description — shown as a Calendly custom answer"),
  }),
  outputSchema: z.object({
    booked: z.boolean(),
    eventStartTime: z.string().optional(),
    eventUri: z.string().optional(),
    inviteeUri: z.string().optional(),
  }),
});
