import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  limit: vi.fn(),
  logOpsEvent: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  clientErrorLimiter: { limit: mocks.limit },
}));

vi.mock("@/lib/ops-events", () => ({
  logOpsEvent: mocks.logOpsEvent,
}));

import { POST } from "@/app/api/ops/client-error/route";

function request(body: unknown): Request {
  return new Request("http://test/api/ops/client-error", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/ops/client-error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.limit.mockResolvedValue({ success: true });
    mocks.logOpsEvent.mockResolvedValue(undefined);
  });

  it("logs sanitized client warnings as warning severity", async () => {
    const res = await POST(
      request({
        event: "client_console_warning",
        message: "Something odd happened",
        path: "/demo",
      })
    );

    expect(res.status).toBe(200);
    expect(mocks.logOpsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "warning",
        event: "client_console_warning",
        area: "client",
      })
    );
  });

  it("rate limits noisy clients", async () => {
    mocks.limit.mockResolvedValueOnce({ success: false });

    const res = await POST(
      request({ event: "client_runtime_error", message: "boom" })
    );

    expect(res.status).toBe(429);
    expect(mocks.logOpsEvent).not.toHaveBeenCalled();
  });
});
