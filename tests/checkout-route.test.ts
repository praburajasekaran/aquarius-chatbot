import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAuthKey: vi.fn(),
  getBpointRedirectBaseUrl: vi.fn(),
  getIntake: vi.fn(),
  redisGet: vi.fn(),
  redisSet: vi.fn(),
  updateIntake: vi.fn(),
}));

vi.mock("@/lib/bpoint", () => ({
  createAuthKey: mocks.createAuthKey,
  getBpointRedirectBaseUrl: mocks.getBpointRedirectBaseUrl,
}));

vi.mock("@/lib/intake", () => ({
  getIntake: mocks.getIntake,
  updateIntake: mocks.updateIntake,
}));

vi.mock("@/lib/kv", () => ({
  redis: {
    get: mocks.redisGet,
    set: mocks.redisSet,
  },
}));

import { POST } from "@/app/api/checkout/route";

function makeReq(body: unknown) {
  return new Request("https://app.test/api/checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://app.test",
    },
    body: JSON.stringify(body),
  });
}

function intake(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "s1",
    clientName: "Test Client",
    clientEmail: "test@example.com",
    clientPhone: "0400000000",
    matterDescription: "Test matter",
    urgency: "urgent",
    displayPrice: "$1,320",
    amountCents: 132000,
    paymentRef: null,
    bpointAuthKey: null,
    createdAt: "2026-05-21T00:00:00.000Z",
    updatedAt: "2026-05-21T00:00:00.000Z",
    ...overrides,
  };
}

describe("POST /api/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBpointRedirectBaseUrl.mockReturnValue("https://app.test");
    mocks.createAuthKey.mockResolvedValue("AK-new");
    mocks.redisGet.mockResolvedValue(null);
    mocks.redisSet.mockResolvedValue("OK");
    mocks.updateIntake.mockResolvedValue(null);
  });

  it("reuses an existing AuthKey for duplicate checkout setup calls", async () => {
    mocks.getIntake.mockResolvedValue(intake({ bpointAuthKey: "AK-existing" }));

    const res = await POST(makeReq({ sessionId: "s1" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ authKey: "AK-existing" });
    expect(mocks.createAuthKey).not.toHaveBeenCalled();
    expect(mocks.updateIntake).not.toHaveBeenCalled();
  });

  it("returns the first claimed AuthKey when concurrent setup loses the Redis claim", async () => {
    mocks.getIntake.mockResolvedValue(intake());
    mocks.redisSet.mockResolvedValueOnce(null);
    mocks.redisGet.mockResolvedValueOnce("AK-winning");

    const res = await POST(makeReq({ sessionId: "s1" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ authKey: "AK-winning" });
    expect(mocks.createAuthKey).toHaveBeenCalledTimes(1);
    expect(mocks.updateIntake).not.toHaveBeenCalled();
  });

  it("creates and stores a new AuthKey when none exists", async () => {
    mocks.getIntake.mockResolvedValue(intake());

    const res = await POST(makeReq({ sessionId: "s1" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ authKey: "AK-new" });
    expect(mocks.createAuthKey).toHaveBeenCalledTimes(1);
    expect(mocks.updateIntake).toHaveBeenCalledWith("s1", {
      bpointAuthKey: "AK-new",
    });
  });

  it("creates a fresh AuthKey when retrying after a failed setup", async () => {
    mocks.getIntake.mockResolvedValue(intake({ bpointAuthKey: "AK-existing" }));

    const res = await POST(makeReq({ sessionId: "s1", forceNew: true }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ authKey: "AK-new" });
    expect(mocks.createAuthKey).toHaveBeenCalledTimes(1);
    expect(mocks.updateIntake).toHaveBeenCalledWith("s1", {
      bpointAuthKey: "AK-new",
    });
  });
});
