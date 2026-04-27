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

export const maxDuration = 30;

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

export async function POST(req: Request) {
  const { messages }: { messages: ChatMessage[] } = await req.json();

  const result = streamText({
    model: geminiFlash,
    system: systemPrompt,
    messages: await convertToModelMessages(messages as UIMessage[]),
    stopWhen: [stepCountIs(10), stopAfterShowOptionsOnly],
    tools,
  });

  return result.toUIMessageStreamResponse();
}
