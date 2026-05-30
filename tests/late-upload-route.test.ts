import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  verifyCookie: vi.fn(),
  tokenLimiterLimit: vi.fn(),
  ipUploadLimiterLimit: vi.fn(),
  globalLimiterLimit: vi.fn(),
  hashToken: vi.fn((value: string) => `hash:${value}`),
  put: vi.fn(),
  checkMagicBytes: vi.fn(),
  handleUploadCompleted: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));

vi.mock("@/lib/upload-session", () => ({
  COOKIE_NAME: "au_upload",
  verifyCookie: mocks.verifyCookie,
}));

vi.mock("@/lib/rate-limit", () => ({
  tokenLimiter: { limit: mocks.tokenLimiterLimit },
  ipUploadLimiter: { limit: mocks.ipUploadLimiterLimit },
  globalLimiter: { limit: mocks.globalLimiterLimit },
}));

vi.mock("@/lib/upload-tokens", () => ({
  hashToken: mocks.hashToken,
}));

vi.mock("@vercel/blob", () => ({
  put: mocks.put,
}));

vi.mock("@/lib/upload/magic-byte-check", () => ({
  checkMagicBytes: mocks.checkMagicBytes,
}));

vi.mock("@/lib/late-upload/handle-completed", () => ({
  handleUploadCompleted: mocks.handleUploadCompleted,
}));

import { POST } from "@/app/api/late-upload/session/route";

function limitOk() {
  return { success: true, pending: Promise.resolve() };
}

function requestWithFile(file: File) {
  const body = new FormData();
  body.append("file", file, file.name);
  return new Request("https://app.test/upload/api/late-upload/session", {
    method: "POST",
    headers: { "x-forwarded-for": "1.2.3.4" },
    body,
  });
}

describe("/api/late-upload/session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookies.mockResolvedValue({
      get: vi.fn(() => ({ value: "signed-cookie" })),
    });
    mocks.verifyCookie.mockReturnValue({
      matterRef: "matter-1",
      sessionId: "sess-1",
      tokenHash: "token-hash",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    mocks.tokenLimiterLimit.mockResolvedValue(limitOk());
    mocks.ipUploadLimiterLimit.mockResolvedValue(limitOk());
    mocks.globalLimiterLimit.mockResolvedValue(limitOk());
    mocks.checkMagicBytes.mockResolvedValue({ ok: true });
    mocks.put.mockResolvedValue({
      url: "https://blob.test/late-uploads/sess-1/sample.pdf",
      pathname: "late-uploads/sess-1/sample.pdf",
      contentType: "application/pdf",
      contentDisposition: "attachment",
    });
    mocks.handleUploadCompleted.mockResolvedValue(undefined);
  });

  it("stores the file server-side and runs the late-upload completion pipeline", async () => {
    const res = await POST(
      requestWithFile(
        new File(["%PDF-1.4\n"], "sample.pdf", { type: "application/pdf" })
      ) as never
    );

    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(mocks.put).toHaveBeenCalledWith(
      expect.stringMatching(
        /^late-uploads\/sess-1\/\d+-[0-9a-f-]+-sample\.pdf$/
      ),
      expect.any(File),
      { access: "private", contentType: "application/pdf" }
    );
    expect(mocks.handleUploadCompleted).toHaveBeenCalledWith({
      blob: expect.objectContaining({
        url: "https://blob.test/late-uploads/sess-1/sample.pdf",
      }),
      matterRef: "matter-1",
      sessionId: "sess-1",
    });
  });

  it("rejects a file whose bytes do not match its declared type", async () => {
    mocks.checkMagicBytes.mockResolvedValueOnce({
      ok: false,
      declared: "application/pdf",
      detected: "text/plain",
      reason: "mismatch",
    });

    const res = await POST(
      requestWithFile(
        new File(["plain text"], "sample.pdf", { type: "application/pdf" })
      ) as never
    );

    expect(res.status).toBe(415);
    await expect(res.json()).resolves.toEqual({
      error:
        "File contents don't match its type. Allowed: PDF, JPG, HEIC/HEIF, PNG, DOC, DOCX, RTF, TXT.",
    });
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.handleUploadCompleted).not.toHaveBeenCalled();
  });
});
