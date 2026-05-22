import { beforeEach, describe, expect, it, vi } from "vitest";

const { getIntakeMock } = vi.hoisted(() => ({
  getIntakeMock: vi.fn(),
}));

vi.mock("@/lib/intake", () => ({
  getIntake: getIntakeMock,
}));

vi.mock("@/lib/rate-limit", () => ({
  pricingProbeLimiter: {
    limit: vi.fn(async () => ({ success: true })),
  },
}));

import { GET } from "./route";

function request() {
  return new Request("http://test/api/intake/s_test/next-step", {
    headers: { "x-forwarded-for": "1.2.3.4" },
  });
}

describe("GET /api/intake/[sessionId]/next-step", () => {
  beforeEach(() => {
    getIntakeMock.mockReset();
  });

  it("returns schedule input for non-urgent intake", async () => {
    getIntakeMock.mockResolvedValue({
      sessionId: "s_test",
      clientName: "Test Client",
      clientEmail: "test@example.com",
      matterDescription: "Traffic matter",
      urgency: "non-urgent",
    });

    const res = await GET(request(), {
      params: Promise.resolve({ sessionId: "s_test" }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      route: "schedule",
      input: {
        sessionId: "s_test",
        prefillName: "Test Client",
        prefillEmail: "test@example.com",
        matterDescription: "Traffic matter",
      },
    });
  });

  it("returns urgent contact input for urgent intake", async () => {
    getIntakeMock.mockResolvedValue({
      sessionId: "s_urgent",
      urgency: "urgent",
    });

    const res = await GET(request(), {
      params: Promise.resolve({ sessionId: "s_urgent" }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      route: "urgent",
      input: { sessionId: "s_urgent" },
    });
  });
});
