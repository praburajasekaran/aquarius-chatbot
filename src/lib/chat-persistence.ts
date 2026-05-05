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
  // crypto.randomUUID is available in all evergreen browsers and modern
  // Node — 122 bits of entropy. The previous Math.random()-based id had
  // ~36 bits of unpredictability and was enumerable in a small time
  // window, which made the sessionId usable as a discovery target for
  // routes like /api/intake/{sessionId}/pricing. Fall back to the old
  // shape only if randomUUID isn't available (very old browsers).
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `s_${crypto.randomUUID()}`;
  }
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function safeRemove(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // localStorage may be unavailable; nothing to do.
  }
}

function isMessageLike(m: unknown): boolean {
  if (typeof m !== "object" || m === null) return false;
  const r = m as Record<string, unknown>;
  return typeof r.id === "string" && Array.isArray(r.parts);
}

function isStored(value: unknown): value is Stored {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.schemaVersion === SCHEMA_VERSION &&
    typeof v.sessionId === "string" &&
    Array.isArray(v.messages) &&
    v.messages.every(isMessageLike) &&
    Number.isFinite(v.expiresAt)
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

// Synchronous read of the currently persisted chat. Returns null if storage
// is unavailable, empty, malformed, expired, or for a different schema. Used
// as a fallback merge source on visibility/focus, since browsers throttle
// background tabs and may defer or drop `storage` events for inactive tabs.
export function peekChat(): { sessionId: string; messages: ChatMessage[] } | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isStored(parsed)) return null;
  if (parsed.expiresAt <= Date.now()) return null;
  return { sessionId: parsed.sessionId, messages: parsed.messages };
}

// Notifies when another tab on the same origin updates the persisted chat.
// `storage` events fire only in OTHER tabs by spec, so we never receive our
// own writes here. Returns an unsubscribe function. No-op outside the browser.
export function subscribeToStorage(
  handler: (next: { sessionId: string; messages: ChatMessage[] } | "cleared") => void
): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    if (e.newValue === null) {
      handler("cleared");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(e.newValue);
    } catch {
      return;
    }
    if (!isStored(parsed)) return;
    if (parsed.expiresAt <= Date.now()) return;
    handler({ sessionId: parsed.sessionId, messages: parsed.messages });
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
