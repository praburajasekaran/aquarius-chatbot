import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  approvedTxnResponse,
  declinedTxnResponse,
  expiredAuthKeyResponse,
} from "./fixtures/bpoint-responses";

vi.mock("@/lib/bpoint", () => ({
  retrieveTransaction: vi.fn(),
}));
vi.mock("@/lib/payments/handleConfirmedPayment", () => ({
  handleConfirmedPayment: vi.fn(),
}));
vi.mock("@/lib/kv", () => ({
  redis: { set: vi.fn() },
}));

import { POST } from "@/app/api/webhooks/bpoint/route";
import { retrieveTransaction } from "@/lib/bpoint";
import { handleConfirmedPayment } from "@/lib/payments/handleConfirmedPayment";
import { redis } from "@/lib/kv";

function makeReq(url: string) {
  return new Request(url, { method: "POST" }) as unknown as import("next/server").NextRequest;
}

describe("POST /api/webhooks/bpoint", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_URL = "https://app.test";
    vi.mocked(redis.set).mockResolvedValue("OK");
    vi.mocked(handleConfirmedPayment).mockResolvedValue(undefined);
  });
  afterEach(() => vi.clearAllMocks());

  it("returns 200 {received:true} when ResultKey missing (no-op)", async () => {
    const res = await POST(makeReq("https://app.test/api/webhooks/bpoint"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true });
    expect(retrieveTransaction).not.toHaveBeenCalled();
  });

  it("calls retrieveTransaction with the ResultKey from query string", async () => {
    vi.mocked(retrieveTransaction).mockResolvedValue(approvedTxnResponse);
    await POST(makeReq("https://app.test/api/webhooks/bpoint?ResultKey=RK-OK"));
    expect(retrieveTransaction).toHaveBeenCalledWith("RK-OK");
  });

  it("accepts lowercase resultkey casing (defensive parse)", async () => {
    vi.mocked(retrieveTransaction).mockResolvedValue(approvedTxnResponse);
    await POST(makeReq("https://app.test/api/webhooks/bpoint?resultkey=RK-LC"));
    expect(retrieveTransaction).toHaveBeenCalledWith("RK-LC");
  });

  it("returns 200 without fan-out when Approved=false", async () => {
    vi.mocked(retrieveTransaction).mockResolvedValue(declinedTxnResponse);
    const res = await POST(makeReq("https://app.test/api/webhooks/bpoint?ResultKey=RK-DEC"));
    expect(res.status).toBe(200);
    expect(handleConfirmedPayment).not.toHaveBeenCalled();
  });

  it("returns 200 without fan-out when APIResponse.ResponseCode !== 0", async () => {
    vi.mocked(retrieveTransaction).mockResolvedValue(expiredAuthKeyResponse);
    const res = await POST(makeReq("https://app.test/api/webhooks/bpoint?ResultKey=RK-EXP"));
    expect(res.status).toBe(200);
    expect(handleConfirmedPayment).not.toHaveBeenCalled();
  });

  it("calls handleConfirmedPayment with mapped fields when approved + SETNX 'OK'", async () => {
    vi.mocked(retrieveTransaction).mockResolvedValue(approvedTxnResponse);
    const res = await POST(makeReq("https://app.test/api/webhooks/bpoint?ResultKey=RK-OK"));
    expect(res.status).toBe(200);
    expect(handleConfirmedPayment).toHaveBeenCalledWith({
      sessionId: "sess-test-001",
      bpointTxnNumber: "TXN-APPROVED-001",
      amountCents: 132000,
    });
  });

  it("does NOT call handleConfirmedPayment when SETNX returns null (dedup collision)", async () => {
    vi.mocked(retrieveTransaction).mockResolvedValue(approvedTxnResponse);
    vi.mocked(redis.set).mockResolvedValueOnce(null);
    const res = await POST(makeReq("https://app.test/api/webhooks/bpoint?ResultKey=RK-DUP"));
    expect(res.status).toBe(200);
    expect(handleConfirmedPayment).not.toHaveBeenCalled();
  });

  it("returns 200 even when handleConfirmedPayment throws (WEBH-04)", async () => {
    vi.mocked(retrieveTransaction).mockResolvedValue(approvedTxnResponse);
    vi.mocked(handleConfirmedPayment).mockRejectedValueOnce(new Error("Resend down"));
    const res = await POST(makeReq("https://app.test/api/webhooks/bpoint?ResultKey=RK-OK"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true });
  });

  it("returns 200 even when retrieveTransaction throws (WEBH-04)", async () => {
    vi.mocked(retrieveTransaction).mockRejectedValueOnce(new Error("BPoint 500"));
    const res = await POST(makeReq("https://app.test/api/webhooks/bpoint?ResultKey=RK-X"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true });
  });
});
