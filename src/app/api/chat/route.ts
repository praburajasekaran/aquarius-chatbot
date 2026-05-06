import {
  convertToModelMessages,
  streamText,
  stepCountIs,
  type StopCondition,
  type UIMessage,
} from "ai";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { chatModel } from "@/lib/openrouter";
import { tools, type ChatMessage } from "@/lib/tools";
import { systemPrompt } from "@/lib/system-prompt";
import { redis } from "@/lib/kv";
import { parseJsonBody } from "@/lib/api/parse";
import { chatLimiter } from "@/lib/rate-limit";
import { sanitizeAssistantText } from "@/lib/sanitize-llm-text";

export const maxDuration = 30;

const TRANSCRIPT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days, matches intake TTL

// Outer shape only — we don't try to validate every part type the AI
// SDK supports (text, tool-call, tool-result, file, reasoning…) since
// the SDK's own UIMessage typing covers the field-by-field semantics.
// What we DO need is a hard ceiling on size so an attacker can't ship
// a 10MB payload at us to flood the LLM context window or burn
// OpenRouter credits before the request even reaches the model.
const MAX_MESSAGE_BYTES = 64 * 1024; // 64 KiB per message
const MessagePart = z
  .looseObject({ type: z.string().max(64) })
  .superRefine((part, ctx) => {
    const size = JSON.stringify(part).length;
    if (size > MAX_MESSAGE_BYTES) {
      ctx.addIssue({
        code: "custom",
        message: `message part exceeds ${MAX_MESSAGE_BYTES} bytes`,
      });
    }
  });
const ChatMessageSchema = z.looseObject({
  id: z.string().min(1).max(200),
  role: z.enum(["system", "user", "assistant"]),
  parts: z.array(MessagePart).max(50),
});

const Body = z.object({
  messages: z.array(ChatMessageSchema).max(200),
  sessionId: z.string().min(1).max(200).optional(),
});

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

// Tools without an `execute` are CLIENT tools — they pause the conversation
// until the visitor interacts with the rendered UI (pay, upload, book, ack).
// AI SDK v6's executeToolCall returns `undefined` for no-execute tools and
// the SDK's loop counts that undefined as a completed result, so the model
// happily re-emits the same client tool on every step until stepCountIs(10)
// fires. That manifested as up to 10 stacked upload modals after a single
// "I've paid" click. Stop the loop the moment the model emits any client
// tool — there's nothing useful for it to do until the visitor responds.
const stopAfterClientPausingTool: StopCondition<typeof tools> = ({ steps }) => {
  const last = steps[steps.length - 1];
  if (!last) return false;
  const calls = last.toolCalls ?? [];
  if (calls.length === 0) return false;
  const toolDefs = tools as unknown as Record<string, { execute?: unknown }>;
  return calls.some((tc) => {
    const def = toolDefs[tc.toolName];
    return def != null && def.execute == null;
  });
};

function formatTranscript(messages: ChatMessage[]): string {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .flatMap((m) => {
      const label = m.role === "user" ? "Client" : "AL Bot";
      const isAssistant = m.role === "assistant";
      const lines = m.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => (isAssistant ? sanitizeAssistantText(p.text) : p.text).trim())
        .filter(Boolean);
      return lines.map((text) => `${label}: ${text}`);
    })
    .join("\n\n");
}

// Strip leaked control tokens from prior assistant turns before they go back
// into the model context. Without this, the model sees its own junk in the
// history and keeps regenerating it (or doubles down with more drift).
function sanitizeMessageHistory(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if (m.role !== "assistant") return m;
    const parts = m.parts.map((p) => {
      const part = p as { type?: string; text?: string };
      if (part.type !== "text" || typeof part.text !== "string") return p;
      const cleaned = sanitizeAssistantText(part.text);
      if (cleaned === part.text) return p;
      return { ...p, text: cleaned };
    });
    return { ...m, parts } as ChatMessage;
  });
}

export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  // Fail open if Redis is unreachable: a transient Upstash blip should not
  // take the whole chatbot offline. The cost-of-abuse window is short, and
  // the route still has its own server-side stop conditions on the LLM loop.
  let limitOk = true;
  try {
    const result = await chatLimiter.limit(ip);
    limitOk = result.success;
  } catch (err) {
    console.error("[chat] rate limiter unavailable, failing open", {
      event: "ratelimit_unavailable",
      err: err instanceof Error ? err.message : String(err),
    });
  }
  if (!limitOk) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = await parseJsonBody(req, Body);
  if (!parsed.ok) return parsed.response;
  const messages = sanitizeMessageHistory(
    parsed.data.messages as unknown as ChatMessage[],
  );
  const sessionId = parsed.data.sessionId;

  if (sessionId) {
    const transcript = formatTranscript(messages);
    if (transcript) {
      after(async () => {
        try {
          await redis.set(`transcript:${sessionId}`, transcript, {
            ex: TRANSCRIPT_TTL_SECONDS,
          });
        } catch (err) {
          console.error("[chat] transcript persist failed", { sessionId, err });
        }
      });
    }
  }

  const result = streamText({
    model: chatModel,
    system: sessionId
      ? `${systemPrompt}\n\n## Current chat session\n\nThe sessionId for this conversation is "${sessionId}". When any tool's input schema requires a sessionId field, you MUST pass exactly this value verbatim. Do NOT invent, generate, or modify the sessionId — it must match the literal string above.`
      : systemPrompt,
    // ignoreIncompleteToolCalls drops any tool part stuck in input-streaming
    // or input-available before conversion. Without this, an abandoned client
    // tool from an earlier turn (user closed the tab between the tool card
    // rendering and clicking it) makes convertToModelMessages throw
    // AI_MissingToolResultsError on every subsequent POST in that session.
    messages: await convertToModelMessages(messages as UIMessage[], {
      ignoreIncompleteToolCalls: true,
    }),
    stopWhen: [stepCountIs(10), stopAfterShowOptionsOnly, stopAfterClientPausingTool],
    tools,
  });

  return result.toUIMessageStreamResponse();
}
