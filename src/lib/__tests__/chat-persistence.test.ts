import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ChatMessage } from "@/lib/tools";

// Minimal in-memory localStorage mock. Vitest runs in node by default,
// so globalThis.localStorage doesn't exist — install our own.
function installMockStorage() {
  const store = new Map<string, string>();
  const mock = {
    getItem: vi.fn((k: string) => store.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => {
      store.set(k, v);
    }),
    removeItem: vi.fn((k: string) => {
      store.delete(k);
    }),
    clear: vi.fn(() => store.clear()),
    key: vi.fn(() => null),
    length: 0,
  };
  vi.stubGlobal("localStorage", mock);
  return { store, mock };
}

const KEY = "aquarius_chat_v1";

const sampleMessages: ChatMessage[] = [
  // Cast through unknown — ChatMessage is a complex AI-SDK type and
  // we only need shape coverage for serialization tests.
  { id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] } as unknown as ChatMessage,
  { id: "m2", role: "assistant", parts: [{ type: "text", text: "hello" }] } as unknown as ChatMessage,
];

describe("chat-persistence", () => {
  beforeEach(() => {
    installMockStorage();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("loadChat", () => {
    it("mints a fresh session when storage is empty", async () => {
      const { loadChat } = await import("@/lib/chat-persistence");
      const result = loadChat();
      // Modern: s_<UUID v4>; legacy fallback (old browsers without
      // crypto.randomUUID): s_<timestamp>_<base36>. Accept either.
      expect(result.sessionId).toMatch(
        /^s_(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+_[a-z0-9]+)$/,
      );
      expect(result.initialMessages).toEqual([]);
    });

    it("restores stored sessionId and messages when valid and unexpired", async () => {
      const { loadChat, saveChat } = await import("@/lib/chat-persistence");
      saveChat("s_existing_abc", sampleMessages);
      const result = loadChat();
      expect(result.sessionId).toBe("s_existing_abc");
      expect(result.initialMessages).toHaveLength(2);
      expect(result.initialMessages[0].id).toBe("m1");
    });

    it("mints fresh and wipes when stored entry is expired", async () => {
      const { loadChat } = await import("@/lib/chat-persistence");
      const expiredPayload = {
        schemaVersion: 1,
        sessionId: "s_old",
        messages: sampleMessages,
        expiresAt: Date.now() - 1000,
      };
      localStorage.setItem(KEY, JSON.stringify(expiredPayload));

      const result = loadChat();
      expect(result.sessionId).not.toBe("s_old");
      expect(result.initialMessages).toEqual([]);
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it("mints fresh when schemaVersion does not match", async () => {
      const { loadChat } = await import("@/lib/chat-persistence");
      const otherSchema = {
        schemaVersion: 999,
        sessionId: "s_old",
        messages: [],
        expiresAt: Date.now() + 60_000,
      };
      localStorage.setItem(KEY, JSON.stringify(otherSchema));

      const result = loadChat();
      expect(result.sessionId).not.toBe("s_old");
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it("mints fresh when stored payload is malformed JSON", async () => {
      const { loadChat } = await import("@/lib/chat-persistence");
      localStorage.setItem(KEY, "{not valid json");

      const result = loadChat();
      expect(result.sessionId).toMatch(/^s_/);
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it("mints fresh when expiresAt is non-finite", async () => {
      const { loadChat } = await import("@/lib/chat-persistence");
      const poisoned = {
        schemaVersion: 1,
        sessionId: "s_old",
        messages: [
          { id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] },
        ],
        expiresAt: null, // JSON.stringify(NaN) === "null", same outcome
      };
      localStorage.setItem(KEY, JSON.stringify(poisoned));

      const result = loadChat();
      expect(result.sessionId).not.toBe("s_old");
      expect(result.initialMessages).toEqual([]);
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it("mints fresh when messages array contains non-message values", async () => {
      const { loadChat } = await import("@/lib/chat-persistence");
      const corrupted = {
        schemaVersion: 1,
        sessionId: "s_old",
        messages: [null, 42, "haha"],
        expiresAt: Date.now() + 60_000,
      };
      localStorage.setItem(KEY, JSON.stringify(corrupted));

      const result = loadChat();
      expect(result.sessionId).not.toBe("s_old");
      expect(result.initialMessages).toEqual([]);
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it("mints fresh after a saved entry's TTL elapses (round-trip)", async () => {
      const { loadChat, saveChat } = await import("@/lib/chat-persistence");
      saveChat("s_round_trip", sampleMessages);
      // Advance fake clock past the 6h TTL.
      vi.advanceTimersByTime(6 * 60 * 60 * 1000 + 1);

      const result = loadChat();
      expect(result.sessionId).not.toBe("s_round_trip");
      expect(result.initialMessages).toEqual([]);
    });

    it("mints fresh when localStorage throws on read", async () => {
      const { loadChat } = await import("@/lib/chat-persistence");
      vi.spyOn(localStorage, "getItem").mockImplementation(() => {
        throw new Error("storage disabled");
      });
      const result = loadChat();
      expect(result.sessionId).toMatch(/^s_/);
      expect(result.initialMessages).toEqual([]);
    });
  });

  describe("saveChat", () => {
    it("writes payload with sliding 6h expiresAt", async () => {
      const { saveChat } = await import("@/lib/chat-persistence");
      saveChat("s_x", sampleMessages);
      const raw = localStorage.getItem(KEY);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.sessionId).toBe("s_x");
      expect(parsed.messages).toHaveLength(2);
      const sixHoursMs = 6 * 60 * 60 * 1000;
      expect(parsed.expiresAt).toBe(Date.now() + sixHoursMs);
    });

    it("refreshes expiresAt on subsequent saves", async () => {
      const { saveChat } = await import("@/lib/chat-persistence");
      saveChat("s_x", sampleMessages);
      vi.advanceTimersByTime(60_000);
      saveChat("s_x", sampleMessages);
      const parsed = JSON.parse(localStorage.getItem(KEY)!);
      const sixHoursMs = 6 * 60 * 60 * 1000;
      expect(parsed.expiresAt).toBe(Date.now() + sixHoursMs);
    });

    it("silently no-ops when localStorage throws", async () => {
      const { saveChat } = await import("@/lib/chat-persistence");
      vi.spyOn(localStorage, "setItem").mockImplementation(() => {
        throw new Error("quota exceeded");
      });
      // Must NOT throw.
      expect(() => saveChat("s_x", sampleMessages)).not.toThrow();
    });
  });

  describe("clearChat", () => {
    it("removes the stored entry", async () => {
      const { saveChat, clearChat } = await import("@/lib/chat-persistence");
      saveChat("s_x", sampleMessages);
      expect(localStorage.getItem(KEY)).not.toBeNull();
      clearChat();
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it("silently no-ops when localStorage throws", async () => {
      const { clearChat } = await import("@/lib/chat-persistence");
      vi.spyOn(localStorage, "removeItem").mockImplementation(() => {
        throw new Error("nope");
      });
      expect(() => clearChat()).not.toThrow();
    });
  });
});
