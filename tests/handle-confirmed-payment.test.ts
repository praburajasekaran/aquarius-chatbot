import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/kv", () => ({
  updateSession: vi.fn(),
  redis: { set: vi.fn() },
}));
vi.mock("@/lib/intake", () => ({
  getIntake: vi.fn(),
}));
vi.mock("@/lib/upload-tokens", () => ({
  createUploadToken: vi.fn(),
  hashToken: (s: string) => `hash:${s}`,
}));
vi.mock("@/lib/resend", () => ({
  resend: { emails: { send: vi.fn() } },
  sendTranscriptEmail: vi.fn(),
}));
vi.mock("@/lib/email/payment-receipt", () => ({ default: () => null }));
vi.mock("@/lib/email/assert-no-tracking", () => ({
  assertNoResendTracking: vi.fn().mockResolvedValue(undefined),
}));

import { handleConfirmedPayment } from "@/lib/payments/handleConfirmedPayment";
import { updateSession } from "@/lib/kv";
import { getIntake } from "@/lib/intake";
import { createUploadToken } from "@/lib/upload-tokens";
import { resend, sendTranscriptEmail } from "@/lib/resend";

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
      bpointTxnNumber: null,
      createdAt: "2026-04-24T00:00:00Z",
      updatedAt: "2026-04-24T00:00:00Z",
    });
    vi.mocked(createUploadToken).mockResolvedValue({ rawToken: "tok-raw" } as never);
  });
  afterEach(() => vi.clearAllMocks());

  it("calls updateSession with paid + bpointTxnNumber + paymentAmount", async () => {
    await handleConfirmedPayment({ sessionId: "s1", bpointTxnNumber: "TXN-1", amountCents: 132000 });
    expect(updateSession).toHaveBeenCalledWith("s1", {
      paymentStatus: "paid",
      bpointTxnNumber: "TXN-1",
      paymentAmount: 132000,
    });
  });

  it("calls createUploadToken with intake fields", async () => {
    await handleConfirmedPayment({ sessionId: "s1", bpointTxnNumber: "TXN-1", amountCents: 132000 });
    expect(createUploadToken).toHaveBeenCalledWith({
      matterRef: "s1",
      clientEmail: "jane@example.com",
      clientName: "Jane",
      sessionId: "s1",
    });
  });

  it("sends PaymentReceipt via resend", async () => {
    await handleConfirmedPayment({ sessionId: "s1", bpointTxnNumber: "TXN-1", amountCents: 132000 });
    expect(resend.emails.send).toHaveBeenCalled();
  });

  it("sends transcript email with bpointTxnNumber", async () => {
    await handleConfirmedPayment({ sessionId: "s1", bpointTxnNumber: "TXN-1", amountCents: 132000 });
    expect(sendTranscriptEmail).toHaveBeenCalledWith(
      expect.objectContaining({ bpointTxnNumber: "TXN-1", paymentAmount: 132000 })
    );
  });

  it("throws when getIntake returns null", async () => {
    vi.mocked(getIntake).mockResolvedValueOnce(null);
    await expect(
      handleConfirmedPayment({ sessionId: "missing", bpointTxnNumber: "TXN-1", amountCents: 132000 })
    ).rejects.toThrow();
  });
});
