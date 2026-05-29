import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redis: {
    lpush: vi.fn(),
    expire: vi.fn(),
    lrange: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock("@/lib/kv", () => ({
  redis: mocks.redis,
}));

import {
  createOpsEventRecord,
  logOpsEvent,
  readOpsEventsForReport,
  shouldSendOpsReport,
  summarizeOpsEvents,
} from "@/lib/ops-events";

describe("ops events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redis.lpush.mockResolvedValue(1);
    mocks.redis.expire.mockResolvedValue(1);
    mocks.redis.lrange.mockResolvedValue([]);
    mocks.redis.get.mockResolvedValue(null);
    mocks.redis.set.mockResolvedValue("OK");
  });

  it("sanitizes sensitive strings before storage", async () => {
    await logOpsEvent({
      severity: "error",
      event: "upload_failed",
      area: "upload",
      message: "Email jane@example.com token abcdefghijklmnopqrstuvwxyz123",
      metadata: { phone: "+61412345678" },
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    const [, payload] = mocks.redis.lpush.mock.calls[0];
    expect(JSON.parse(payload)).toMatchObject({
      message: "Email [email removed] token [token removed]",
      metadata: { phone: "[phone removed]" },
    });
  });

  it("does not throw when Redis logging fails", async () => {
    mocks.redis.lpush.mockRejectedValueOnce(new Error("redis down"));

    await expect(
      logOpsEvent({
        severity: "warning",
        event: "test_warning",
        area: "test",
        message: "Test warning",
      })
    ).resolves.toBeUndefined();
  });

  it("reads and summarizes the report window", async () => {
    const event = createOpsEventRecord({
      severity: "info",
      event: "in_chat_upload_success",
      area: "upload.in_chat",
      message: "ok",
      metadata: { maxFileBytes: 20 * 1024 * 1024 },
      now: new Date("2026-05-28T10:00:00.000Z"),
    });
    mocks.redis.lrange.mockResolvedValueOnce([JSON.stringify(event)]);

    const events = await readOpsEventsForReport(new Date("2026-05-28T10:00:00.000Z"), 1);
    expect(events).toHaveLength(1);
    expect(summarizeOpsEvents(events)).toMatchObject({
      bySeverity: { error: 0, warning: 0, info: 1 },
      uploadSuccesses: 1,
      largestUploadBytes: 20 * 1024 * 1024,
    });
  });

  it("suppresses reports sent within the prior fortnight", async () => {
    mocks.redis.get.mockResolvedValueOnce("2026-05-20T00:00:00.000Z");

    await expect(
      shouldSendOpsReport(new Date("2026-05-28T00:00:00.000Z"))
    ).resolves.toBe(false);
  });
});
