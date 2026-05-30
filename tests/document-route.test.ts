import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  head: vi.fn(),
  resolveDocumentAccessToken: vi.fn(),
  verifySessionSecret: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({
  get: mocks.get,
  head: mocks.head,
}));

vi.mock("@/lib/document-access", () => ({
  resolveDocumentAccessToken: mocks.resolveDocumentAccessToken,
}));

vi.mock("@/lib/kv", () => ({
  verifySessionSecret: mocks.verifySessionSecret,
}));

import { GET } from "@/app/api/documents/[...path]/route";

function streamFromText(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

describe("document proxy route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.head.mockResolvedValue({
      pathname: "uploads/sess-1/file.pdf",
      contentType: "application/pdf",
    });
    mocks.get.mockResolvedValue({
      stream: streamFromText("pdf bytes"),
    });
  });

  it("streams a private blob when the document token matches the path", async () => {
    mocks.resolveDocumentAccessToken.mockResolvedValue({
      pathname: "late-file.pdf",
      sessionId: "sess-1",
      fileName: "late-file.pdf",
      contentType: "application/pdf",
      createdAt: "2026-05-30T00:00:00.000Z",
    });
    mocks.head.mockResolvedValue({
      pathname: "late-file.pdf",
      contentType: "application/pdf",
    });

    const response = await GET(
      new Request("https://app.test/api/documents/late-file.pdf?token=tok"),
      { params: Promise.resolve({ path: ["late-file.pdf"] }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.get).toHaveBeenCalledWith("late-file.pdf", {
      access: "private",
    });
    expect(await response.text()).toBe("pdf bytes");
  });

  it("rejects a token scoped to a different blob pathname", async () => {
    mocks.resolveDocumentAccessToken.mockResolvedValue({
      pathname: "other.pdf",
      sessionId: "sess-1",
      fileName: "other.pdf",
      contentType: "application/pdf",
      createdAt: "2026-05-30T00:00:00.000Z",
    });

    const response = await GET(
      new Request("https://app.test/api/documents/late-file.pdf?token=tok"),
      { params: Promise.resolve({ path: ["late-file.pdf"] }) }
    );

    expect(response.status).toBe(404);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("keeps the legacy sessionSecret path for in-chat upload URLs", async () => {
    mocks.verifySessionSecret.mockResolvedValue(true);

    const response = await GET(
      new Request(
        "https://app.test/api/documents/uploads/sess-1/file.pdf?secret=secret"
      ),
      { params: Promise.resolve({ path: ["uploads", "sess-1", "file.pdf"] }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.verifySessionSecret).toHaveBeenCalledWith("sess-1", "secret");
    expect(mocks.get).toHaveBeenCalledWith("uploads/sess-1/file.pdf", {
      access: "private",
    });
  });
});
