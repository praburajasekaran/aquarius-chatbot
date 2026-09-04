import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redisGetdel: vi.fn(),
}));

vi.mock("@/lib/kv", () => ({
  redis: {
    getdel: mocks.redisGetdel,
  },
}));

import { GET } from "@/app/api/checkout/confirm/verify/route";

describe("GET /api/checkout/confirm/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redisGetdel.mockResolvedValue({ sessionId: "sess-1" });
  });

  it("redeems a proof only for its matching session", async () => {
    const res = await GET(
      new Request(
        "https://app.test/api/checkout/confirm/verify?proof=abcdefghijklmnopqrstuvwxyz123456&sessionId=sess-1",
      ),
    );

    await expect(res.json()).resolves.toEqual({ confirmed: true });
    expect(mocks.redisGetdel).toHaveBeenCalledWith(
      "bpoint-payment-proof:sess-1:abcdefghijklmnopqrstuvwxyz123456",
    );
  });

  it("rejects a proof for a different session", async () => {
    const res = await GET(
      new Request(
        "https://app.test/api/checkout/confirm/verify?proof=abcdefghijklmnopqrstuvwxyz123456&sessionId=other",
      ),
    );

    await expect(res.json()).resolves.toEqual({ confirmed: false });
    expect(mocks.redisGetdel).toHaveBeenCalledWith(
      "bpoint-payment-proof:other:abcdefghijklmnopqrstuvwxyz123456",
    );
  });

  it("rejects malformed or missing proof input without touching Redis", async () => {
    const res = await GET(
      new Request("https://app.test/api/checkout/confirm/verify?proof=short"),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ confirmed: false });
    expect(mocks.redisGetdel).not.toHaveBeenCalled();
  });
});
