import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UploadTokenRecord } from "@/types";

const mocks = vi.hoisted(() => ({
  resolveUploadToken: vi.fn(),
  getLimiterLimit: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "1.2.3.4" })),
}));

vi.mock("@/lib/upload-tokens", () => ({
  resolveUploadToken: mocks.resolveUploadToken,
}));

vi.mock("@/lib/rate-limit", () => ({
  getLimiter: {
    limit: mocks.getLimiterLimit,
  },
}));

import { GET, POST } from "@/app/upload/[token]/route";

function record(overrides: Partial<UploadTokenRecord> = {}): UploadTokenRecord {
  return {
    matterRef: "matter-1",
    sessionId: "sess-1",
    clientEmail: "client@example.com",
    clientName: "Test Client",
    createdAt: "2026-05-30T00:00:00.000Z",
    ...overrides,
  };
}

function request(method: "GET" | "POST") {
  return new Request("https://app.test/upload/raw-token", { method });
}

describe("/upload/[token]", () => {
  beforeEach(() => {
    process.env.UPLOAD_COOKIE_SECRET = "test-secret";
    mocks.resolveUploadToken.mockReset();
    mocks.getLimiterLimit.mockReset();
    mocks.getLimiterLimit.mockResolvedValue({ success: true });
  });

  it("renders copy that tells clients the upload link can be reused", async () => {
    mocks.resolveUploadToken.mockResolvedValue({
      record: record(),
      tokenHash: "hash-1",
    });

    const res = await GET(request("GET"), {
      params: Promise.resolve({ token: "raw-token" }),
    });

    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toContain(
      "This secure link stays valid for 7 days"
    );
  });

  it("does not consume the token when minting an upload-session cookie", async () => {
    mocks.resolveUploadToken.mockResolvedValue({
      record: record(),
      tokenHash: "hash-1",
    });

    const first = await POST(request("POST"), {
      params: Promise.resolve({ token: "raw-token" }),
    });
    const second = await POST(request("POST"), {
      params: Promise.resolve({ token: "raw-token" }),
    });

    expect(first.status).toBe(303);
    expect(second.status).toBe(303);
    expect(first.headers.get("location")).toBe(
      "https://app.test/upload/session"
    );
    expect(second.headers.get("location")).toBe(
      "https://app.test/upload/session"
    );
    expect(first.headers.get("set-cookie")).toContain("au_upload=");
    expect(second.headers.get("set-cookie")).toContain("au_upload=");
    expect(mocks.resolveUploadToken).toHaveBeenCalledTimes(2);
  });
});
