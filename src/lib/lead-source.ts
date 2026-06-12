import { redis } from "@/lib/kv";

const LEAD_SOURCE_TTL_SECONDS = 60 * 60 * 24 * 7;
const MAX_SOURCE_URL_LENGTH = 2048;

export function leadSourceKey(sessionId: string): string {
  return `lead-source:${sessionId}`;
}

export function normalizeLeadSourceUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_SOURCE_URL_LENGTH) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  url.username = "";
  url.password = "";
  url.hash = "";

  const normalized = url.toString();
  return normalized.length <= MAX_SOURCE_URL_LENGTH ? normalized : null;
}

export async function persistLeadSourceUrl(
  sessionId: string,
  sourceUrl: string
): Promise<void> {
  await redis.set(leadSourceKey(sessionId), sourceUrl, {
    ex: LEAD_SOURCE_TTL_SECONDS,
  });
}

export async function getLeadSourceUrl(
  sessionId: string
): Promise<string | null> {
  return redis.get<string>(leadSourceKey(sessionId));
}
