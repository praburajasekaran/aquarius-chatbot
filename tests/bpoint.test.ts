import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getBpointIframeUrl, retrieveTransaction } from "@/lib/bpoint";
import { approvedTxnResponse } from "./fixtures/bpoint-responses";

describe("retrieveTransaction", () => {
  const ORIGINAL_ENV = { ...process.env };
  beforeEach(() => {
    process.env.BPOINT_API_USERNAME = "u";
    process.env.BPOINT_API_PASSWORD = "p";
    process.env.BPOINT_MERCHANT_NUMBER = "12345";
    global.fetch = vi.fn();
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it("calls GET https://www.bpoint.com.au/webapi/v2/txns/{resultKey} with Basic Auth", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => approvedTxnResponse,
    });
    await retrieveTransaction("RK-123");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://www.bpoint.com.au/webapi/v2/txns/RK-123",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(/^Basic /),
        }),
      })
    );
  });

  it("uses the UAT host when BPOINT_ENV=uat", async () => {
    process.env.BPOINT_ENV = "uat";
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => approvedTxnResponse,
    });

    await retrieveTransaction("RK-UAT");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://www.bpoint.uat.linkly.com.au/webapi/v2/txns/RK-UAT",
      expect.any(Object)
    );
    expect(getBpointIframeUrl("AK-UAT")).toBe(
      "https://www.bpoint.uat.linkly.com.au/webapi/v2/txns/iframe/AK-UAT"
    );
  });

  it("normalizes accidental wrapping quotes in BPoint env values", async () => {
    process.env.BPOINT_ENV = "\"uat\"";
    process.env.BPOINT_API_USERNAME = "\"u\"";
    process.env.BPOINT_API_PASSWORD = "\"p\"";
    process.env.BPOINT_MERCHANT_NUMBER = "\"12345\"";
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => approvedTxnResponse,
    });

    await retrieveTransaction("RK-QUOTED");

    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    const encoded = headers.Authorization.replace(/^Basic /, "");
    expect(url).toBe(
      "https://www.bpoint.uat.linkly.com.au/webapi/v2/txns/RK-QUOTED"
    );
    expect(Buffer.from(encoded, "base64").toString("utf8")).toBe(
      "u|12345:p"
    );
  });

  it("honours BPOINT_API_URL and normalizes /webapi/v2 once", async () => {
    process.env.BPOINT_ENV = "uat";
    process.env.BPOINT_API_URL = "https://custom-bpoint.example/webapi/v2";
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => approvedTxnResponse,
    });

    await retrieveTransaction("RK-CUSTOM");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://custom-bpoint.example/webapi/v2/txns/RK-CUSTOM",
      expect.any(Object)
    );
    expect(getBpointIframeUrl("AK/CUSTOM")).toBe(
      "https://custom-bpoint.example/webapi/v2/txns/iframe/AK%2FCUSTOM"
    );
  });

  it("throws when fetch returns non-OK", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "boom",
    });
    await expect(retrieveTransaction("RK-FAIL")).rejects.toThrow(/BPoint retrieve failed: 500/);
  });
});
