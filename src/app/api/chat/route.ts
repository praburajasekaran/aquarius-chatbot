import {
  convertToModelMessages,
  streamText,
  stepCountIs,
  type StopCondition,
  type UIMessage,
} from "ai";
import { geminiFlash } from "@/lib/openrouter";
import { tools, type ChatMessage } from "@/lib/tools";
import { systemPrompt } from "@/lib/system-prompt";
import { redis } from "@/lib/kv";

export const maxDuration = 30;

const TRANSCRIPT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days, matches intake TTL

// showOptions is a pure-UI tool that auto-resolves server-side. If the model
// emits text alongside it in step N, we don't want step N+1 to fire — Gemini
// tends to re-narrate the same paragraph, producing duplicate assistant
// bubbles. Stop the loop the moment a step's only tool calls are showOptions.
const stopAfterShowOptionsOnly: StopCondition<typeof tools> = ({ steps }) => {
  const last = steps[steps.length - 1];
  if (!last) return false;
  const toolCalls = last.toolCalls ?? [];
  if (toolCalls.length === 0) return false;
  return toolCalls.every((tc) => tc.toolName === "showOptions");
};

function formatTranscript(messages: ChatMessage[]): string {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .flatMap((m) => {
      const label = m.role === "user" ? "Client" : "Chatbot";
      const lines = m.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text.trim())
        .filter(Boolean);
      return lines.map((text) => `${label}: ${text}`);
    })
    .join("\n\n");
}

export async function POST(req: Request) {
  const {
    messages,
    sessionId,
  }: { messages: ChatMessage[]; sessionId?: string } = await req.json();

  if (sessionId) {
    const transcript = formatTranscript(messages);
    if (transcript) {
      redis
        .set(`transcript:${sessionId}`, transcript, {
          ex: TRANSCRIPT_TTL_SECONDS,
        })
        .catch((err) =>
          console.error("[chat] transcript persist failed", { sessionId, err })
        );
    }
  }

  const result = streamText({
    model: geminiFlash,
    system: sessionId
      ? `${systemPrompt}\n\n## Current chat session\n\nThe sessionId for this conversation is "${sessionId}". When any tool's input schema requires a sessionId field, you MUST pass exactly this value verbatim. Do NOT invent, generate, or modify the sessionId — it must match the literal string above.`
      : systemPrompt,
    messages: await convertToModelMessages(messages as UIMessage[]),
    stopWhen: [stepCountIs(10), stopAfterShowOptionsOnly],
    tools,
  });

  return result.toUIMessageStreamResponse();
}
