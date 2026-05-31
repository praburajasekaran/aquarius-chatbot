import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  handleConfirmedPayment: vi.fn(),
  redisGet: vi.fn(),
  redisSet: vi.fn(),
  retrieveTransaction: vi.fn(),
  sendFirmIntegrationAlertEmail: vi.fn(),
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>(
    "next/server"
  );
  return {
    ...actual,
    after: mocks.after,
  };
});

vi.mock("@/lib/bpoint", () => ({
  retrieveTransaction: mocks.retrieveTransaction,
}));

vi.mock("@/lib/kv", () => ({
  redis: {
    get: mocks.redisGet,
    set: mocks.redisSet,
  },
}));

vi.mock("@/lib/payments/handleConfirmedPayment", () => ({
  handleConfirmedPayment: mocks.handleConfirmedPayment,
}));

vi.mock("@/lib/resend", () => ({
  sendFirmIntegrationAlertEmail: mocks.sendFirmIntegrationAlertEmail,
}));

import { GET } from "@/app/api/checkout/confirm/route";

const approvedTxn = {
  APIResponse: { ResponseCode: "0" },
  TxnResp: {
    Approved: true,
    Amount: 9900,
    BankResponseCode: "00",
    Crn1: "sess_paid",
    ResponseCode: "0",
    ResponseText: "approved",
    TxnNumber: "txn_123",
  },
};

function request(path: string): Request {
  return new Request(`https://app.test${path}`);
}

describe("GET /api/checkout/confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.retrieveTransaction.mockResolvedValue(approvedTxn);
    mocks.redisGet.mockResolvedValue(null);
    mocks.redisSet.mockResolvedValue("OK");
    mocks.handleConfirmedPayment.mockResolvedValue(undefined);
    mocks.sendFirmIntegrationAlertEmail.mockResolvedValue(undefined);
  });

  it("redirects immediately and schedules paid fan-out after the response", async () => {
    const res = await GET(
      request(
        "/api/checkout/confirm?ResultKey=result_123&ResponseCode=0&returnTo=https://client.test/thanks"
      )
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://client.test/?payment=success"
    );
    expect(mocks.redisSet).toHaveBeenCalledWith("bpoint-txn:txn_123", "pending", {
      nx: true,
      ex: 60 * 60 * 24 * 7,
    });
    expect(mocks.after).toHaveBeenCalledOnce();
    expect(mocks.handleConfirmedPayment).not.toHaveBeenCalled();

    const callback = mocks.after.mock.calls[0]?.[0] as () => Promise<void>;
    await callback();

    expect(mocks.handleConfirmedPayment).toHaveBeenCalledWith({
      sessionId: "sess_paid",
      bpointTxnNumber: "txn_123",
      amountCents: 9900,
    });
  });

  it("does not schedule fan-out when the BPoint transaction was already claimed", async () => {
    mocks.redisSet.mockResolvedValueOnce(null);

    const res = await GET(
      request("/api/checkout/confirm?ResultKey=result_123&ResponseCode=0")
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.test/?payment=success");
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.handleConfirmedPayment).not.toHaveBeenCalled();
  });

  it("alerts the firm from the background callback when fan-out fails", async () => {
    mocks.handleConfirmedPayment.mockRejectedValueOnce(new Error("boom"));

    await GET(request("/api/checkout/confirm?ResultKey=result_123&ResponseCode=0"));
    const callback = mocks.after.mock.calls[0]?.[0] as () => Promise<void>;
    await callback();

    expect(mocks.sendFirmIntegrationAlertEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Paid BPoint transaction needs manual follow-up",
        reason: "boom",
        sessionId: "sess_paid",
      })
    );
  });
});
