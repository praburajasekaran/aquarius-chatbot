import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/lib/tools";

const { starts, zadd } = vi.hoisted(() => {
  const starts = new Map<string, number>();
  return {
    starts,
    zadd: vi.fn(async (key: string, _options: unknown, entry: { member: string; score: number }) => {
      const id = `${key}:${entry.member}`;
      if (starts.has(id)) return 0;
      starts.set(id, entry.score);
      return 1;
    }),
  };
});

vi.mock("@/lib/kv", () => ({ redis: { zadd } }));

import { recordChatStart } from "@/lib/chat-starts";

const firstMessage: ChatMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "I need bail advice" }] },
];

describe("chat starts", () => {
  beforeEach(() => {
    starts.clear();
    vi.stubEnv("VERCEL_ENV", "production");
    vi.spyOn(Date, "now").mockReturnValue(1792490400000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("counts concurrent first-message requests once and preserves the first timestamp", async () => {
    expect(await Promise.all([
      recordChatStart("s_one", firstMessage),
      recordChatStart("s_one", firstMessage),
    ])).toEqual([true, false]);
    vi.mocked(Date.now).mockReturnValue(1792490500000);
    expect(await recordChatStart("s_one", firstMessage)).toBe(false);
    expect([...starts.values()]).toEqual([1792490400000]);
    expect(zadd).toHaveBeenCalledWith("analytics:chat-starts:production", { nx: true }, {
      member: createHash("sha256").update("s_one").digest("hex"),
      score: 1792490400000,
    });
  });

  it("counts a new conversation separately", async () => {
    expect(await recordChatStart("s_one", firstMessage)).toBe(true);
    expect(await recordChatStart("s_two", firstMessage)).toBe(true);
    expect(starts.size).toBe(2);
  });

  it("ignores opens, blank text, missing sessions, and resumed conversations", async () => {
    expect(await recordChatStart("s_empty", [])).toBe(false);
    expect(await recordChatStart(undefined, firstMessage)).toBe(false);
    expect(await recordChatStart("s_blank", [
      { id: "u1", role: "user", parts: [{ type: "text", text: "  " }] },
    ])).toBe(false);
    expect(await recordChatStart("s_resumed", [
      ...firstMessage,
      { id: "u2", role: "user", parts: [{ type: "text", text: "What does it cost?" }] },
    ])).toBe(false);
    expect(starts.size).toBe(0);
  });

  it("keeps preview and development counts out of production", async () => {
    await recordChatStart("s_one", firstMessage);
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(await recordChatStart("s_one", firstMessage)).toBe(true);
    vi.stubEnv("VERCEL_ENV", undefined);
    expect(await recordChatStart("s_one", firstMessage)).toBe(true);
    expect([...starts.keys()].map((key) => key.split(":")[2])).toEqual([
      "production", "preview", "development",
    ]);
  });

  it("does not stop a chat when Redis is unavailable", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    zadd.mockRejectedValueOnce(new Error("Redis unavailable"));
    expect(await recordChatStart("s_one", firstMessage)).toBe(false);
    expect(warning).toHaveBeenCalledOnce();
    expect(await recordChatStart("s_one", firstMessage)).toBe(true);
  });
});
