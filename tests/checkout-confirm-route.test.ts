import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  retrieveTransaction: vi.fn(),
  redisGet: vi.fn(),
  redisSet: vi.fn(),
  handleConfirmedPayment: vi.fn(),
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

function approvedTxn() {
  return {
    APIResponse: { ResponseCode: 0, ResponseText: "Success" },
    TxnResp: {
      TxnNumber: "TXN-1",
      Approved: true,
      Crn1: "sess-1",
      Amount: 72600,
      BankResponseCode: "00",
      ResponseText: "Approved",
    },
  };
}

describe("GET /api/checkout/confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.retrieveTransaction.mockResolvedValue(approvedTxn());
    mocks.redisSet.mockResolvedValue("OK");
    mocks.redisGet.mockResolvedValue(null);
    mocks.handleConfirmedPayment.mockResolvedValue(undefined);
    mocks.sendFirmIntegrationAlertEmail.mockResolvedValue(undefined);
  });

  it("alerts the firm when an approved payment cannot be fanned out", async () => {
    mocks.handleConfirmedPayment.mockRejectedValueOnce(
      new Error("[payments] no intake for sessionId=sess-1 (txn=TXN-1)")
    );

    const res = await GET(
      new Request("https://app.test/api/checkout/confirm?ResultKey=rk_1")
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.test/?payment=success");
    expect(mocks.sendFirmIntegrationAlertEmail).not.toHaveBeenCalled();

    const callback = mocks.after.mock.calls[0]?.[0] as () => Promise<void>;
    await callback();

    expect(mocks.sendFirmIntegrationAlertEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Paid BPoint transaction needs manual follow-up",
        sessionId: "sess-1",
        details: expect.objectContaining({
          "BPoint transaction": "TXN-1",
          "Amount cents": 72600,
        }),
      })
    );
  });
});
