import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { retrieveTransaction } from "@/lib/bpoint";
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

  it("throws when fetch returns non-OK", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "boom",
    });
    await expect(retrieveTransaction("RK-FAIL")).rejects.toThrow(/BPoint retrieve failed: 500/);
  });
});
