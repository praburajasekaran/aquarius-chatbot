import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolvePostUploadBookingStepMock } = vi.hoisted(() => ({
  resolvePostUploadBookingStepMock: vi.fn(),
}));

vi.mock("@/lib/post-upload-booking/resolve-post-upload-booking-step", () => ({
  resolvePostUploadBookingStep: resolvePostUploadBookingStepMock,
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
    resolvePostUploadBookingStepMock.mockReset();
  });

  it("returns public session booking step data", async () => {
    resolvePostUploadBookingStepMock.mockResolvedValue({
      kind: "session-booking",
      sessionId: "s_test",
      prefillName: "Test Client",
      prefillEmail: "test@example.com",
      matterSummary: "Traffic matter",
    });

    const res = await GET(request(), {
      params: Promise.resolve({ sessionId: "s_test" }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      kind: "session-booking",
      sessionId: "s_test",
      prefillName: "Test Client",
      prefillEmail: "test@example.com",
      matterSummary: "Traffic matter",
    });
    expect(resolvePostUploadBookingStepMock).toHaveBeenCalledWith({
      sessionId: "s_test",
    });
  });

  it("returns public urgent contact step data", async () => {
    resolvePostUploadBookingStepMock.mockResolvedValue({
      kind: "urgent-contact",
      sessionId: "s_urgent",
    });

    const res = await GET(request(), {
      params: Promise.resolve({ sessionId: "s_urgent" }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      kind: "urgent-contact",
      sessionId: "s_urgent",
    });
  });

  it("hides unavailable reasons from the browser", async () => {
    resolvePostUploadBookingStepMock.mockResolvedValue({
      kind: "unavailable",
      reason: "missing-intake",
    });

    const res = await GET(request(), {
      params: Promise.resolve({ sessionId: "s_missing" }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ kind: "unavailable" });
  });
});
