import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntakeRecord } from "@/lib/intake";

const mocks = vi.hoisted(() => ({
  redisGet: vi.fn(),
  redisSet: vi.fn(),
  redisDel: vi.fn(),
  getSession: vi.fn(),
  createSession: vi.fn(),
  updateSession: vi.fn(),
  createUploadToken: vi.fn(),
  hashToken: vi.fn(),
  revokeTokenByHash: vi.fn(),
  sendAndLog: vi.fn(),
  sendFirmIntegrationAlertEmail: vi.fn(),
  sendTranscriptEmail: vi.fn(),
  getIntake: vi.fn(),
  sendSms: vi.fn(),
  scheduleReminderSms: vi.fn(),
  cancelEmailReminder: vi.fn(),
  logActivity: vi.fn(),
  sendToZapier: vi.fn(),
}));

vi.mock("@/lib/kv", () => ({
  redis: {
    get: mocks.redisGet,
    set: mocks.redisSet,
    del: mocks.redisDel,
  },
  getSession: mocks.getSession,
  createSession: mocks.createSession,
  updateSession: mocks.updateSession,
}));

vi.mock("@/lib/upload-tokens", () => ({
  createUploadToken: mocks.createUploadToken,
  hashToken: mocks.hashToken,
  revokeTokenByHash: mocks.revokeTokenByHash,
}));

vi.mock("@/lib/resend", () => ({
  sendAndLog: mocks.sendAndLog,
  sendFirmIntegrationAlertEmail: mocks.sendFirmIntegrationAlertEmail,
  sendTranscriptEmail: mocks.sendTranscriptEmail,
}));

vi.mock("@/lib/intake", () => ({
  getIntake: mocks.getIntake,
}));

vi.mock("@/lib/sms/dispatch", () => ({
  sendSms: mocks.sendSms,
}));

vi.mock("@/lib/sms/reminder", () => ({
  scheduleReminderSms: mocks.scheduleReminderSms,
}));

vi.mock("@/lib/email/assert-no-tracking", () => ({
  assertNoResendTracking: vi.fn(),
}));

vi.mock("@/lib/email-reminders/dispatch", () => ({
  cancelEmailReminder: mocks.cancelEmailReminder,
}));

vi.mock("@/lib/digest/activity-log", () => ({
  logActivity: mocks.logActivity,
}));

vi.mock("@/lib/zapier", () => ({
  sendToZapier: mocks.sendToZapier,
}));

import { handleIntakePaid } from "@/lib/intake/handle-paid";

function intake(overrides: Partial<IntakeRecord> = {}): IntakeRecord {
  return {
    sessionId: "sess-1",
    clientName: "Taylor Smith",
    clientEmail: "taylor@example.com",
    clientPhone: "0400000000",
    matterDescription: "I need help with an urgent assault charge in court",
    urgency: "urgent",
    displayPrice: "$1,320",
    amountCents: 132000,
    paymentRef: null,
    bpointAuthKey: null,
    createdAt: "2026-05-22T00:00:00.000Z",
    updatedAt: "2026-05-22T00:00:00.000Z",
    ...overrides,
  };
}

describe("handleIntakePaid Smokeball fan-out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_URL = "https://app.test";
    process.env.ZAPIER_WEBHOOK_URL = "https://zap.test/create";
    delete process.env.RESEND_FROM_EMAIL;
    delete process.env.CALENDLY_BOOKING_URL;
    delete process.env.NEXT_PUBLIC_CALENDLY_BOOKING_URL;
    mocks.getSession.mockResolvedValue(null);
    mocks.createSession.mockResolvedValue(undefined);
    mocks.updateSession.mockResolvedValue(undefined);
    mocks.createUploadToken.mockResolvedValue({ rawToken: "raw-token" });
    mocks.hashToken.mockReturnValue("a".repeat(64));
    mocks.redisSet.mockResolvedValue("OK");
    mocks.redisGet.mockResolvedValue(null);
    mocks.getIntake.mockResolvedValue(intake());
    mocks.sendToZapier.mockResolvedValue(new Response(null, { status: 200 }));
    mocks.sendSms.mockResolvedValue(undefined);
    mocks.scheduleReminderSms.mockResolvedValue(undefined);
    mocks.cancelEmailReminder.mockResolvedValue(undefined);
    mocks.logActivity.mockResolvedValue(undefined);
    mocks.sendFirmIntegrationAlertEmail.mockResolvedValue(undefined);
  });

  it("sends create-matter Zap payload after the paid intake is claimed", async () => {
    await handleIntakePaid({
      sessionId: "sess-1",
      paymentRef: "BPOINT-1",
      paymentAmount: 132000,
      clientEmail: "taylor@example.com",
      clientName: "Taylor Smith",
      source: "bpoint",
    });

    expect(mocks.sendToZapier).toHaveBeenCalledWith(
      "https://zap.test/create",
      expect.objectContaining({
        event: "paid_intake.create_matter",
        matter_ref: "sess-1",
        payment_ref: "BPOINT-1",
        matter_summary: "I need help with an urgent assault charge in court",
        matter_title: "Taylor Smith - need help urgent assault",
      })
    );
    expect(JSON.stringify(mocks.sendToZapier.mock.calls[0][1]).toLowerCase()).not.toContain(
      "transcript"
    );
  });

  it("does not send create-matter Zap for duplicate paid events", async () => {
    mocks.redisSet.mockResolvedValueOnce(null);
    mocks.redisGet.mockResolvedValueOnce("b".repeat(64));

    await expect(
      handleIntakePaid({
        sessionId: "sess-1",
        paymentRef: "BPOINT-1",
        paymentAmount: 132000,
        clientEmail: "taylor@example.com",
        clientName: "Taylor Smith",
        source: "bpoint",
      })
    ).resolves.toEqual({ status: "duplicate" });

    expect(mocks.sendToZapier).not.toHaveBeenCalled();
  });

  it("sends one recovery receipt for a duplicate paid event when no receipt was recorded", async () => {
    process.env.RESEND_FROM_EMAIL = "noreply@app.test";
    mocks.redisSet
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("OK")
      .mockResolvedValueOnce("OK");
    mocks.redisGet
      .mockResolvedValueOnce("b".repeat(64))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mocks.sendAndLog.mockResolvedValue({ id: "email-1" });

    const result = await handleIntakePaid({
      sessionId: "sess-1",
      paymentRef: "BPOINT-1",
      paymentAmount: 132000,
      clientEmail: "taylor@example.com",
      clientName: "Taylor Smith",
      source: "bpoint",
    });

    expect(result).toMatchObject({
      status: "duplicate",
      uploadLink: "https://app.test/upload/raw-token",
      rawToken: "raw-token",
    });
    expect(mocks.sendAndLog).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "taylor@example.com",
        subject: "Your payment receipt — Demo Law Firm",
      }),
      { event: "intake_receipt", sessionId: "sess-1" }
    );
    expect(mocks.revokeTokenByHash).not.toHaveBeenCalled();
    expect(mocks.sendToZapier).not.toHaveBeenCalled();
  });

  it("alerts the firm when create-matter Zap fails after retry", async () => {
    mocks.sendToZapier.mockRejectedValue(new Error("Zap failed"));

    await handleIntakePaid({
      sessionId: "sess-1",
      paymentRef: "BPOINT-1",
      paymentAmount: 132000,
      clientEmail: "taylor@example.com",
      clientName: "Taylor Smith",
      source: "bpoint",
    });

    expect(mocks.sendFirmIntegrationAlertEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Smokeball matter creation failed",
        reason: "Zap failed",
        sessionId: "sess-1",
        clientEmail: "taylor@example.com",
      })
    );
  });

  it("uses the public Calendly URL in the payment receipt when the server URL is not configured", async () => {
    process.env.RESEND_FROM_EMAIL = "noreply@app.test";
    delete process.env.CALENDLY_BOOKING_URL;
    process.env.NEXT_PUBLIC_CALENDLY_BOOKING_URL = "https://calendly.test/book";
    mocks.getIntake.mockResolvedValue(intake({ urgency: "non-urgent" }));
    mocks.sendAndLog.mockResolvedValue({ id: "email-1" });

    await handleIntakePaid({
      sessionId: "sess-1",
      paymentRef: "BPOINT-1",
      paymentAmount: 72600,
      clientEmail: "taylor@example.com",
      clientName: "Taylor Smith",
      source: "bpoint",
    });

    const receiptCall = mocks.sendAndLog.mock.calls.find(
      ([, context]) => context.event === "intake_receipt"
    );
    expect(JSON.stringify(receiptCall?.[0].react)).toContain(
      "https://calendly.test/book"
    );
  });
});
