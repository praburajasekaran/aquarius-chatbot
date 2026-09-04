import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  approvedTxnResponse,
  declinedTxnResponse,
  expiredAuthKeyResponse,
} from "./fixtures/bpoint-responses";

const nextMocks = vi.hoisted(() => ({
  after: vi.fn(),
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>(
    "next/server"
  );
  return {
    ...actual,
    after: nextMocks.after,
  };
});

vi.mock("@/lib/bpoint", () => ({
  retrieveTransaction: vi.fn(),
}));
vi.mock("@/lib/payments/handleConfirmedPayment", () => ({
  handleConfirmedPayment: vi.fn(),
}));
vi.mock("@/lib/kv", () => ({
  redis: { get: vi.fn(), set: vi.fn() },
}));

import { GET } from "@/app/api/checkout/confirm/route";
import { retrieveTransaction } from "@/lib/bpoint";
import { handleConfirmedPayment } from "@/lib/payments/handleConfirmedPayment";
import { redis } from "@/lib/kv";

function makeReq(url: string) {
  return new Request(url) as unknown as import("next/server").NextRequest;
}

async function runScheduledFanout() {
  const callback = nextMocks.after.mock.calls[0]?.[0] as
    | (() => Promise<void>)
    | undefined;
  expect(callback).toBeDefined();
  await callback?.();
}

describe("GET /api/checkout/confirm", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_URL = "https://app.test";
    vi.mocked(redis.get).mockResolvedValue(null);
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

  it("schedules handleConfirmedPayment with mapped fields when approved", async () => {
    vi.mocked(retrieveTransaction).mockResolvedValue(approvedTxnResponse);
    await GET(makeReq("https://app.test/api/checkout/confirm?ResultKey=RK-OK&ResponseCode=0"));
    expect(handleConfirmedPayment).not.toHaveBeenCalled();
    await runScheduledFanout();
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

  it("uses a server-recorded process fallback when BPoint retrieve rejects a successful ResultKey", async () => {
    vi.mocked(retrieveTransaction).mockResolvedValue({
      APIResponse: { ResponseCode: 118, ResponseText: "Invalid transaction number" },
      TxnResp: null,
    });
    vi.mocked(redis.get).mockResolvedValueOnce(approvedTxnResponse);

    const res = await GET(
      makeReq("https://app.test/api/checkout/confirm?ResultKey=RK-OK&ResponseCode=0")
    );

    expect(redis.get).toHaveBeenCalledWith("bpoint-result:RK-OK");
    expect(handleConfirmedPayment).not.toHaveBeenCalled();
    await runScheduledFanout();
    expect(handleConfirmedPayment).toHaveBeenCalledWith({
      sessionId: "sess-test-001",
      bpointTxnNumber: "TXN-APPROVED-001",
      amountCents: 132000,
    });
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.origin).toBe("https://app.test");
    expect(location.searchParams.get("payment")).toBe("success");
    expect(location.searchParams.get("paymentProof")).toMatch(/^[A-Za-z0-9_-]{43}$/);
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
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.origin).toBe("https://app.test");
    expect(location.pathname).toBe("/");
    expect(location.searchParams.get("payment")).toBe("success");
    expect(location.searchParams.get("paymentProof")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("never redirects an approved callback to an arbitrary return origin", async () => {
    vi.mocked(retrieveTransaction).mockResolvedValue(approvedTxnResponse);
    const res = await GET(
      makeReq(
        "https://app.test/api/checkout/confirm?ResultKey=RK-OK&ResponseCode=0&returnTo=https%3A%2F%2Fevil.example%2Fdone",
      ),
    );
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.origin).toBe("https://app.test");
    expect(location.searchParams.get("payment")).toBe("success");
  });
});
