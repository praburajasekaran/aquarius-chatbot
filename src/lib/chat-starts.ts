import { createHash } from "node:crypto";
import { redis } from "@/lib/kv";
import type { ChatMessage } from "@/lib/tools";

export async function recordChatStart(
  sessionId: string | undefined,
  messages: ChatMessage[],
): Promise<boolean> {
  const userMessages = messages.filter((message) => message.role === "user");
  if (!sessionId || userMessages.length !== 1) return false;
  const hasText = userMessages[0].parts.some(
    (part) => part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0,
  );
  if (!hasText) return false;

  const environment = process.env.VERCEL_ENV ?? "development";
  const member = createHash("sha256").update(sessionId).digest("hex");
  try {
    // One atomic insert preserves the first timestamp across retries and tabs.
    // No expiry: this count must outlive the conversation and its transcript.
    return (await redis.zadd(`analytics:chat-starts:${environment}`, { nx: true }, {
      score: Date.now(),
      member,
    })) === 1;
  } catch (error) {
    console.warn("[chat] start tracking failed", { error });
    return false;
  }
}
