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

import { GET } from "@/app/api/checkout/confirm/route";
import { retrieveTransaction } from "@/lib/bpoint";
import { handleConfirmedPayment } from "@/lib/payments/handleConfirmedPayment";
import { redis } from "@/lib/kv";

function makeReq(url: string) {
  return new Request(url) as unknown as import("next/server").NextRequest;
}

describe("GET /api/checkout/confirm", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_URL = "https://app.test";
    vi.mocked(redis.set).mockResolvedValue("OK");
    vi.mocked(handleConfirmedPayment).mockResolvedValue(undefined);
  });
  afterEach(() => vi.clearAllMocks());

  it("redirects to failed when ResultKey missing", async () => {
    const res = await GET(makeReq("https://app.test/api/checkout/confirm"));
    expect(res.headers.get("location")).toMatch(/payment=failed/);
    expect(retrieveTransaction).not.toHaveBeenCalled();
  });

  it("redirects to failed when ResponseCode != 0 (early exit)", async () => {
    const res = await GET(makeReq("https://app.test/api/checkout/confirm?ResultKey=RK&ResponseCode=99"));
    expect(res.headers.get("location")).toMatch(/payment=failed/);
    expect(retrieveTransaction).not.toHaveBeenCalled();
  });

  it("calls retrieveTransaction with the ResultKey", async () => {
    vi.mocked(retrieveTransaction).mockResolvedValue(approvedTxnResponse);
    await GET(makeReq("https://app.test/api/checkout/confirm?ResultKey=RK-OK&ResponseCode=0"));
    expect(retrieveTransaction).toHaveBeenCalledWith("RK-OK");
  });

  it("calls handleConfirmedPayment with mapped fields when approved", async () => {
    vi.mocked(retrieveTransaction).mockResolvedValue(approvedTxnResponse);
    await GET(makeReq("https://app.test/api/checkout/confirm?ResultKey=RK-OK&ResponseCode=0"));
    expect(handleConfirmedPayment).toHaveBeenCalledWith({
      sessionId: "sess-test-001",
      bpointTxnNumber: "TXN-APPROVED-001",
      amountCents: 132000,
    });
  });

  it("does NOT fan-out and redirects declined when Approved=false", async () => {
    vi.mocked(retrieveTransaction).mockResolvedValue(declinedTxnResponse);
    const res = await GET(makeReq("https://app.test/api/checkout/confirm?ResultKey=RK-DEC&ResponseCode=0"));
    expect(handleConfirmedPayment).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toMatch(/payment=failed.*reason=declined/);
  });

  it("does NOT fan-out when APIResponse.ResponseCode != 0", async () => {
    vi.mocked(retrieveTransaction).mockResolvedValue(expiredAuthKeyResponse);
    const res = await GET(makeReq("https://app.test/api/checkout/confirm?ResultKey=RK-EXP&ResponseCode=0"));
    expect(handleConfirmedPayment).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toMatch(/payment=failed/);
  });

  it("does NOT fan-out twice when SETNX returns null (dedup)", async () => {
    vi.mocked(retrieveTransaction).mockResolvedValue(approvedTxnResponse);
    vi.mocked(redis.set).mockResolvedValueOnce(null);
    await GET(makeReq("https://app.test/api/checkout/confirm?ResultKey=RK-DUP&ResponseCode=0"));
    expect(handleConfirmedPayment).not.toHaveBeenCalled();
  });

  it("redirects to /?payment=success on approved + first call", async () => {
    vi.mocked(retrieveTransaction).mockResolvedValue(approvedTxnResponse);
    const res = await GET(makeReq("https://app.test/api/checkout/confirm?ResultKey=RK-OK&ResponseCode=0"));
    expect(res.headers.get("location")).toBe("https://app.test/?payment=success");
  });
});
