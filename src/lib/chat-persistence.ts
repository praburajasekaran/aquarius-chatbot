import type { ChatMessage } from "@/lib/tools";

const KEY = "aquarius_chat_v1";
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const SCHEMA_VERSION = 1 as const;

interface Stored {
  schemaVersion: typeof SCHEMA_VERSION;
  sessionId: string;
  messages: ChatMessage[];
  expiresAt: number;
}

function generateSessionId(): string {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function safeRemove(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // localStorage may be unavailable; nothing to do.
  }
}

function isStored(value: unknown): value is Stored {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.schemaVersion === SCHEMA_VERSION &&
    typeof v.sessionId === "string" &&
    Array.isArray(v.messages) &&
    typeof v.expiresAt === "number"
  );
}

export function loadChat(): {
  sessionId: string;
  initialMessages: ChatMessage[];
} {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return { sessionId: generateSessionId(), initialMessages: [] };
  }

  if (!raw) {
    return { sessionId: generateSessionId(), initialMessages: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    safeRemove();
    return { sessionId: generateSessionId(), initialMessages: [] };
  }

  if (!isStored(parsed)) {
    safeRemove();
    return { sessionId: generateSessionId(), initialMessages: [] };
  }

  if (parsed.expiresAt <= Date.now()) {
    safeRemove();
    return { sessionId: generateSessionId(), initialMessages: [] };
  }

  return {
    sessionId: parsed.sessionId,
    initialMessages: parsed.messages,
  };
}

export function saveChat(sessionId: string, messages: ChatMessage[]): void {
  const payload: Stored = {
    schemaVersion: SCHEMA_VERSION,
    sessionId,
    messages,
    expiresAt: Date.now() + TTL_MS,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // Quota exceeded, storage disabled, etc. Silently degrade.
  }
}

export function clearChat(): void {
  safeRemove();
}
