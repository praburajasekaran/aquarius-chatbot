import { redis } from "@/lib/kv";

function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

function monthKey(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `unanswered:${yyyy}-${mm}`;
}

const UNANSWERED_TTL = 60 * 60 * 24 * 62; // 62 days (~2 months)

export async function logUnanswered(
  question: string,
  sessionId = "unknown"
): Promise<void> {
  const normalized = normalizeQuestion(question);
  if (!normalized) return;

  const key = monthKey();
  const score = Date.now();

  try {
    await redis.zadd(key, { score, member: normalized });
    await redis.expire(key, UNANSWERED_TTL);
  } catch (err) {
    console.error("[kb] failed to log unanswered question", {
      event: "unanswered_log_failed",
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
