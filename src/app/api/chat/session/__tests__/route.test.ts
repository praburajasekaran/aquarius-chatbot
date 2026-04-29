import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/kv", () => ({
  redis: { del: vi.fn() },
  deleteSession: vi.fn(),
}));

import { redis, deleteSession } from "@/lib/kv";
import { DELETE } from "@/app/api/chat/session/route";

function makeRequest(body: unknown): Request {
  return new Request("http://test/api/chat/session", {
    method: "DELETE",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("DELETE /api/chat/session", () => {
  beforeEach(() => {
    vi.mocked(deleteSession).mockResolvedValue(undefined);
    vi.mocked(redis.del).mockResolvedValue(0);
  });

  it("returns 204 and deletes session + transcript when sessionId is provided", async () => {
    const res = await DELETE(makeRequest({ sessionId: "s_abc" }));
    expect(res.status).toBe(204);
    expect(vi.mocked(deleteSession)).toHaveBeenCalledWith("s_abc");
    expect(vi.mocked(redis.del)).toHaveBeenCalledWith("transcript:s_abc");
  });

  it("returns 400 when sessionId is missing", async () => {
    const res = await DELETE(makeRequest({}));
    expect(res.status).toBe(400);
    expect(vi.mocked(deleteSession)).not.toHaveBeenCalled();
    expect(vi.mocked(redis.del)).not.toHaveBeenCalled();
  });

  it("returns 400 when sessionId is not a string", async () => {
    const res = await DELETE(makeRequest({ sessionId: 123 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when body is not valid JSON", async () => {
    const req = new Request("http://test/api/chat/session", {
      method: "DELETE",
      body: "not json",
      headers: { "content-type": "application/json" },
    });
    const res = await DELETE(req);
    expect(res.status).toBe(400);
  });

  it("returns 204 even when redis.del throws (best-effort)", async () => {
    vi.mocked(redis.del).mockRejectedValueOnce(new Error("boom"));
    const res = await DELETE(makeRequest({ sessionId: "s_abc" }));
    expect(res.status).toBe(204);
  });
});
