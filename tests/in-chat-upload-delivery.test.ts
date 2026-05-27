import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntakeRecord } from "@/lib/intake";

const mocks = vi.hoisted(() => ({
  getIntake: vi.fn(),
  getMatterForSession: vi.fn(),
  sendAndLog: vi.fn(),
  sendToZapier: vi.fn(),
  FirmInChatUploadNotificationEmail: vi.fn((props) => ({
    template: "FirmInChatUploadNotificationEmail",
    props,
  })),
}));

vi.mock("@/lib/intake", () => ({
  getIntake: mocks.getIntake,
}));

vi.mock("@/lib/session-matter-map", () => ({
  getMatterForSession: mocks.getMatterForSession,
}));

vi.mock("@/lib/resend", () => ({
  sendAndLog: mocks.sendAndLog,
}));

vi.mock("@/lib/zapier", () => ({
  sendToZapier: mocks.sendToZapier,
}));

vi.mock("@/lib/email/templates/firm-in-chat-upload-notification", () => ({
  default: mocks.FirmInChatUploadNotificationEmail,
}));

import { deliverInChatUploadsToZapier } from "@/lib/in-chat-upload/deliver-to-zapier";

const baseFile = {
  url: "https://blob.test/file-1.pdf",
  name: "file-1.pdf",
  contentType: "application/pdf",
  sizeBytes: 1234,
};

function intake(overrides: Partial<IntakeRecord> = {}): IntakeRecord {
  return {
    sessionId: "sess-1",
    clientName: "Taylor Smith",
    clientEmail: "taylor@example.com",
    clientPhone: "0400000000",
    matterDescription: "Assault charge",
    urgency: "non-urgent",
    displayPrice: "$1,320",
    amountCents: 132000,
    paymentRef: "BPOINT-1",
    bpointAuthKey: null,
    createdAt: "2026-05-22T00:00:00.000Z",
    updatedAt: "2026-05-22T00:00:00.000Z",
    ...overrides,
  };
}

describe("in-chat upload delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ZAPIER_ATTACH_WEBHOOK_URL = "https://zap.test/attach";
    delete process.env.ZAPIER_AUDIT_WEBHOOK_URL;
    process.env.RESEND_FROM_EMAIL = "firm@example.com";
    process.env.FIRM_NOTIFY_EMAIL = "uploads@example.com";
    mocks.getIntake.mockResolvedValue(intake());
    mocks.getMatterForSession.mockResolvedValue({
      smokeballMatterId: "SMOKE-1",
    });
    mocks.sendToZapier.mockResolvedValue(new Response(null, { status: 200 }));
    mocks.sendAndLog.mockResolvedValue({ id: "email-1" });
  });

  it("attaches when a matter mapping exists and emails the firm with sent status", async () => {
    await deliverInChatUploadsToZapier({
      sessionId: "sess-1",
      files: [baseFile],
      waitOptions: { attempts: 1, delayMs: 0 },
    });

    expect(mocks.sendToZapier).toHaveBeenCalledWith(
      "https://zap.test/attach",
      expect.objectContaining({
        matter_ref: "sess-1",
        smokeball_matter_id: "SMOKE-1",
        file: expect.objectContaining({ name: "file-1.pdf" }),
      })
    );
    expect(mocks.sendAndLog).toHaveBeenCalledOnce();
    expect(mocks.FirmInChatUploadNotificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        clientName: "Taylor Smith",
        clientEmail: "taylor@example.com",
        matterRef: "sess-1",
        smokeballMatterId: "SMOKE-1",
        files: [
          expect.objectContaining({
            name: "file-1.pdf",
            status: "Sent to Smokeball",
          }),
        ],
      })
    );
  });

  it("does not attempt attach when mapping is missing and emails manual-required status", async () => {
    mocks.getMatterForSession.mockResolvedValue(null);

    await deliverInChatUploadsToZapier({
      sessionId: "sess-1",
      files: [baseFile],
      waitOptions: { attempts: 2, delayMs: 0 },
    });

    expect(mocks.getMatterForSession).toHaveBeenCalledTimes(2);
    expect(mocks.sendToZapier).not.toHaveBeenCalled();
    expect(mocks.sendAndLog).toHaveBeenCalledOnce();
    expect(mocks.FirmInChatUploadNotificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        smokeballMatterId: null,
        files: [
          expect.objectContaining({
            name: "file-1.pdf",
            status: "Manual attach required",
            detail: expect.stringContaining("No Smokeball matter mapping"),
          }),
        ],
      })
    );
  });

  it("marks manual-required when the attach Zap fails", async () => {
    mocks.sendToZapier.mockRejectedValue(new Error("Zap down"));

    await deliverInChatUploadsToZapier({
      sessionId: "sess-1",
      files: [baseFile],
      waitOptions: { attempts: 1, delayMs: 0 },
    });

    expect(mocks.sendToZapier).toHaveBeenCalledOnce();
    expect(mocks.sendAndLog).toHaveBeenCalledOnce();
    expect(mocks.FirmInChatUploadNotificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [
          expect.objectContaining({
            name: "file-1.pdf",
            status: "Manual attach required",
            detail: "Zap down",
          }),
        ],
      })
    );
  });

  it("sends one firm email for multiple uploaded files", async () => {
    await deliverInChatUploadsToZapier({
      sessionId: "sess-1",
      files: [
        baseFile,
        {
          ...baseFile,
          url: "https://blob.test/file-2.pdf",
          name: "file-2.pdf",
          sizeBytes: 5678,
        },
      ],
      waitOptions: { attempts: 1, delayMs: 0 },
    });

    expect(mocks.sendToZapier).toHaveBeenCalledTimes(2);
    expect(mocks.sendAndLog).toHaveBeenCalledOnce();
    expect(mocks.sendAndLog).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Upload received - Taylor Smith (2 files)",
      }),
      { event: "in_chat_upload_firm_notify", sessionId: "sess-1" }
    );
    expect(mocks.FirmInChatUploadNotificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [
          expect.objectContaining({ name: "file-1.pdf" }),
          expect.objectContaining({ name: "file-2.pdf" }),
        ],
      })
    );
  });
});
