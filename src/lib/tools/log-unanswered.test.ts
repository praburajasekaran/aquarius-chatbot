import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redis: {
    zadd: vi.fn(),
    hset: vi.fn(),
    hsetnx: vi.fn(),
    hincrby: vi.fn(),
    expire: vi.fn(),
    zrange: vi.fn(),
    hgetall: vi.fn(),
  },
}));

vi.mock("@/lib/kv", () => ({
  redis: mocks.redis,
}));

import {
  categorizeKnowledgeGap,
  logUnanswered,
  readKnowledgeGapsForMonth,
  sanitizeKnowledgeGapWording,
} from "@/lib/tools/log-unanswered";

describe("knowledge gap logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redis.zadd.mockResolvedValue(1);
    mocks.redis.hset.mockResolvedValue(1);
    mocks.redis.hsetnx.mockResolvedValue(1);
    mocks.redis.hincrby.mockResolvedValue(1);
    mocks.redis.expire.mockResolvedValue(1);
  });

  it("sanitizes obvious contact and reference details", () => {
    expect(
      sanitizeKnowledgeGapWording(
        "Can you help? Email jane@example.com or call +61 412 345 678, payment reference ABC123456."
      )
    ).toBe(
      "Can you help? Email [email removed] or call [phone removed], [reference removed]."
    );
  });

  it("stores a sanitized canonical wording and increments exact normalized repeats", async () => {
    const date = new Date("2026-05-10T02:00:00.000Z");

    await logUnanswered("Can I get bail? Call 0412 345 678", "s_1", date);
    await logUnanswered("can i get bail call 0412345678", "s_2", date);

    expect(mocks.redis.zadd).toHaveBeenCalledTimes(2);
    expect(mocks.redis.zadd).toHaveBeenNthCalledWith(1, "knowledge-gaps:2026-05", {
      score: date.getTime(),
      member: "can i get bail call phone removed",
    });
    expect(mocks.redis.zadd).toHaveBeenNthCalledWith(2, "knowledge-gaps:2026-05", {
      score: date.getTime(),
      member: "can i get bail call phone removed",
    });
    expect(mocks.redis.hsetnx).toHaveBeenCalledWith(
      "knowledge-gap:2026-05:can%20i%20get%20bail%20call%20phone%20removed",
      "text",
      "Can I get bail? Call [phone removed]"
    );
    expect(mocks.redis.hincrby).toHaveBeenCalledTimes(2);
  });

  it("categorizes current coverage, future practice-area, and logistics gaps", () => {
    expect(categorizeKnowledgeGap("Can I get bail before court?")).toBe(
      "Current Coverage Gap"
    );
    expect(categorizeKnowledgeGap("Do you help with divorce property settlement?")).toBe(
      "Future Practice-Area Signal"
    );
    expect(categorizeKnowledgeGap("How much does a consultation cost?")).toBe(
      "Firm Logistics / Fees"
    );
  });

  it("reads monthly gaps sorted by times asked then alphabetically", async () => {
    mocks.redis.zrange.mockResolvedValue(["b question", "a question", "missing"]);
    mocks.redis.hgetall
      .mockResolvedValueOnce({
        normalized: "b question",
        text: "B question?",
        timesAsked: "2",
        category: "General Information Gap",
      })
      .mockResolvedValueOnce({
        normalized: "a question",
        text: "A question?",
        timesAsked: 2,
        category: "Current Coverage Gap",
      })
      .mockResolvedValueOnce(null);

    await expect(readKnowledgeGapsForMonth("2026-05")).resolves.toEqual([
      {
        normalized: "a question",
        text: "A question?",
        timesAsked: 2,
        category: "Current Coverage Gap",
      },
      {
        normalized: "b question",
        text: "B question?",
        timesAsked: 2,
        category: "General Information Gap",
      },
    ]);
  });
});
