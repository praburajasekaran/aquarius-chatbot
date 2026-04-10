import {
  convertToModelMessages,
  streamText,
  stepCountIs,
  type UIMessage,
} from "ai";
import { geminiFlash } from "@/lib/openrouter";
import { tools, type ChatMessage } from "@/lib/tools";
import { systemPrompt } from "@/lib/system-prompt";

export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages }: { messages: ChatMessage[] } = await req.json();

  const result = streamText({
    model: geminiFlash,
    system: systemPrompt,
    messages: await convertToModelMessages(messages as UIMessage[]),
    stopWhen: stepCountIs(5),
    tools,
  });

  return result.toUIMessageStreamResponse();
}
