import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/intake", () => ({
  getIntake: vi.fn(),
}));
vi.mock("@/lib/intake/handle-paid", () => ({
  handleIntakePaid: vi.fn(),
}));

import { handleConfirmedPayment } from "@/lib/payments/handleConfirmedPayment";
import { getIntake } from "@/lib/intake";
import { handleIntakePaid } from "@/lib/intake/handle-paid";

describe("handleConfirmedPayment", () => {
  beforeEach(() => {
    process.env.APP_URL = "https://app.test";
    process.env.RESEND_FROM_EMAIL = "noreply@test";
    vi.mocked(getIntake).mockResolvedValue({
      sessionId: "s1",
      clientName: "Jane",
      clientEmail: "jane@example.com",
      clientPhone: "0400000000",
      matterDescription: "matter",
      urgency: "urgent",
      displayPrice: "$1,320",
      amountCents: 132000,
      paymentRef: null,
      bpointAuthKey: null,
      createdAt: "2026-04-24T00:00:00Z",
      updatedAt: "2026-04-24T00:00:00Z",
    });
    vi.mocked(handleIntakePaid).mockResolvedValue({ status: "ok" });
  });
  afterEach(() => vi.clearAllMocks());

  it("loads intake and delegates to the provider-neutral paid fan-out", async () => {
    await handleConfirmedPayment({
      sessionId: "s1",
      bpointTxnNumber: "TXN-1",
      amountCents: 132000,
    });

    expect(getIntake).toHaveBeenCalledWith("s1");
    expect(handleIntakePaid).toHaveBeenCalledWith({
      sessionId: "s1",
      paymentRef: "TXN-1",
      paymentAmount: 132000,
      clientEmail: "jane@example.com",
      clientName: "Jane",
      source: "bpoint",
    });
  });

  it("propagates fan-out failures to the caller", async () => {
    vi.mocked(handleIntakePaid).mockRejectedValueOnce(new Error("fan-out failed"));
    await expect(
      handleConfirmedPayment({
        sessionId: "s1",
        bpointTxnNumber: "TXN-1",
        amountCents: 132000,
      })
    ).rejects.toThrow("fan-out failed");
  });

  it("throws when getIntake returns null", async () => {
    vi.mocked(getIntake).mockResolvedValueOnce(null);
    await expect(
      handleConfirmedPayment({ sessionId: "missing", bpointTxnNumber: "TXN-1", amountCents: 132000 })
    ).rejects.toThrow();
  });
});
