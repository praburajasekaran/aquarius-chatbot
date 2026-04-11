import { tool } from "ai";
import { z } from "zod";

// No execute — renders client-side file upload UI
export const uploadDocuments = tool({
  description:
    "Present a document upload interface to the client so they can attach relevant files (e.g. charge sheets, court documents, photos). Call this after payment is confirmed. Documents are optional — the client may skip if they have none.",
  inputSchema: z.object({
    sessionId: z.string().describe("The chat session ID"),
    message: z
      .string()
      .optional()
      .describe("Optional context message shown above the upload area"),
  }),
  outputSchema: z.object({
    uploaded: z.number().describe("Number of documents the visitor uploaded (0 if skipped)"),
  }),
});
