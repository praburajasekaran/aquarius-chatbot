import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getIntake: vi.fn(),
  sendBookingNotificationEmail: vi.fn(),
  sendFirmIntegrationAlertEmail: vi.fn(),
  deliverAppointmentNoteToSmokeball: vi.fn(),
}));

vi.mock("@/lib/intake", () => ({
  getIntake: mocks.getIntake,
}));

vi.mock("@/lib/resend", () => ({
  sendBookingNotificationEmail: mocks.sendBookingNotificationEmail,
  sendFirmIntegrationAlertEmail: mocks.sendFirmIntegrationAlertEmail,
}));

vi.mock("@/lib/smokeball/appointment-note", () => ({
  deliverAppointmentNoteToSmokeball: mocks.deliverAppointmentNoteToSmokeball,
}));

import { POST } from "@/app/api/webhooks/calendly/route";

function signedRequest(body: unknown) {
  const raw = JSON.stringify(body);
  const t = "1770000000";
  const v1 = crypto
    .createHmac("sha256", "signing-secret")
    .update(`${t}.${raw}`)
    .digest("hex");

  return new Request("https://app.test/api/webhooks/calendly", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "calendly-webhook-signature": `t=${t},v1=${v1}`,
    },
    body: raw,
  }) as unknown as import("next/server").NextRequest;
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    event: "invitee.created",
    payload: {
      name: "Taylor Smith",
      email: "taylor@example.com",
      uri: "https://api.calendly.com/invitees/inv-1",
      scheduled_event: {
        uri: "https://api.calendly.com/scheduled_events/event-1",
        start_time: "2026-05-25T01:00:00.000Z",
      },
      tracking: {
        utm_content: "sess-1",
      },
      ...overrides,
    },
  };
}

describe("Calendly webhook Smokeball appointment note", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CALENDLY_WEBHOOK_SIGNING_KEY = "signing-secret";
    mocks.getIntake.mockResolvedValue({
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
    });
    mocks.sendBookingNotificationEmail.mockResolvedValue(undefined);
    mocks.sendFirmIntegrationAlertEmail.mockResolvedValue(undefined);
    mocks.deliverAppointmentNoteToSmokeball.mockResolvedValue("ok");
  });

  it("delivers an appointment-note Zap when a session tracking value exists", async () => {
    const res = await POST(signedRequest(payload()));

    expect(res.status).toBe(200);
    expect(mocks.deliverAppointmentNoteToSmokeball).toHaveBeenCalledWith({
      sessionId: "sess-1",
      clientName: "Taylor Smith",
      clientEmail: "taylor@example.com",
      eventStartTime: "2026-05-25T01:00:00.000Z",
      eventUri: "https://api.calendly.com/scheduled_events/event-1",
      inviteeUri: "https://api.calendly.com/invitees/inv-1",
      intake: expect.objectContaining({ paymentRef: "BPOINT-1" }),
    });
  });

  it("alerts the firm when Calendly does not include session tracking", async () => {
    const res = await POST(signedRequest(payload({ tracking: {} })));

    expect(res.status).toBe(200);
    expect(mocks.deliverAppointmentNoteToSmokeball).not.toHaveBeenCalled();
    expect(mocks.sendFirmIntegrationAlertEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Smokeball appointment note needs manual follow-up",
        sessionId: "(missing)",
        clientEmail: "taylor@example.com",
      })
    );
  });
});
