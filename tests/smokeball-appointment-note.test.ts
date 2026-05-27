import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntakeRecord } from "@/lib/intake";

const mocks = vi.hoisted(() => ({
  getMatterForSession: vi.fn(),
  sendFirmIntegrationAlertEmail: vi.fn(),
  sendToZapier: vi.fn(),
}));

vi.mock("@/lib/session-matter-map", () => ({
  getMatterForSession: mocks.getMatterForSession,
  isValidSmokeballMatterId: (value: unknown) => {
    if (typeof value !== "string") return false;
    const normalized = value.trim().toLowerCase();
    return (
      normalized.length > 0 &&
      normalized !== "null" &&
      normalized !== "undefined" &&
      normalized !== "none" &&
      normalized !== "n/a"
    );
  },
}));

vi.mock("@/lib/resend", () => ({
  sendFirmIntegrationAlertEmail: mocks.sendFirmIntegrationAlertEmail,
}));

vi.mock("@/lib/zapier", () => ({
  sendToZapier: mocks.sendToZapier,
}));

import {
  buildAppointmentNoteZapPayload,
  deliverAppointmentNoteToSmokeball,
} from "@/lib/smokeball/appointment-note";

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

const input = {
  sessionId: "sess-1",
  clientName: "Taylor Smith",
  clientEmail: "taylor@example.com",
  eventStartTime: "2026-05-25T01:00:00.000Z",
  eventUri: "https://api.calendly.com/scheduled_events/event-1",
  inviteeUri: "https://api.calendly.com/scheduled_events/event-1/invitees/inv-1",
  intake: intake(),
};

describe("Smokeball appointment note delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ZAPIER_APPOINTMENT_NOTE_WEBHOOK_URL = "https://zap.test/note";
    mocks.sendToZapier.mockResolvedValue(new Response(null, { status: 200 }));
    mocks.sendFirmIntegrationAlertEmail.mockResolvedValue(undefined);
  });

  it("builds a booking-specific note payload", () => {
    const payload = buildAppointmentNoteZapPayload(input, "SMOKE-1");

    expect(payload).toMatchObject({
      event: "booking.appointment_note",
      matter_ref: "sess-1",
      session_id: "sess-1",
      smokeball_matter_id: "SMOKE-1",
      smokeball_note_target: "matter",
      client_name: "Taylor Smith",
      client_email: "taylor@example.com",
      appointment_start_time: "2026-05-25T01:00:00.000Z",
      appointment_time_zone: "Australia/Sydney",
      calendly_event_uri: input.eventUri,
      calendly_invitee_uri: input.inviteeUri,
      payment_ref: "BPOINT-1",
      matter_note_title: "Legal Strategy Session booked",
      source: "chatbot/calendly",
    });
    expect(payload.matter_note_body).toContain("Legal Strategy Session booked");
    expect(payload.matter_note_body).toContain("Appointment date:");
    expect(payload.matter_note_body).toContain("Appointment time:");
    expect(payload.matter_note_body).toContain("Australia/Sydney");
    expect(payload.matter_note_body).toContain("Payment reference: BPOINT-1");
    expect(payload.matter_note_body).toContain("Session ID: sess-1");
    expect(payload.matter_note_body).not.toContain("Assault charge");
    expect(payload.note).toBe(payload.matter_note_body);
  });

  it("waits briefly for a delayed matter mapping then sends the note Zap", async () => {
    mocks.getMatterForSession
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ smokeballMatterId: "SMOKE-1" });

    await expect(
      deliverAppointmentNoteToSmokeball(input, { attempts: 2, delayMs: 0 })
    ).resolves.toBe("ok");

    expect(mocks.sendToZapier).toHaveBeenCalledWith(
      "https://zap.test/note",
      expect.objectContaining({
        matter_ref: "sess-1",
        smokeball_matter_id: "SMOKE-1",
        smokeball_note_target: "matter",
        matter_note_body: expect.stringContaining("Legal Strategy Session booked"),
      })
    );
    expect(mocks.sendFirmIntegrationAlertEmail).not.toHaveBeenCalled();
  });

  it("alerts the firm when no matter mapping arrives", async () => {
    mocks.getMatterForSession.mockResolvedValue(null);

    await expect(
      deliverAppointmentNoteToSmokeball(input, { attempts: 2, delayMs: 0 })
    ).resolves.toBe("skipped");

    expect(mocks.sendToZapier).not.toHaveBeenCalled();
    expect(mocks.sendFirmIntegrationAlertEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Smokeball appointment note needs manual follow-up",
        sessionId: "sess-1",
      })
    );
  });

  it("treats a null-like matter mapping as missing", async () => {
    mocks.getMatterForSession.mockResolvedValue({ smokeballMatterId: "null" });

    await expect(
      deliverAppointmentNoteToSmokeball(input, { attempts: 1, delayMs: 0 })
    ).resolves.toBe("skipped");

    expect(mocks.sendToZapier).not.toHaveBeenCalled();
    expect(mocks.sendFirmIntegrationAlertEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Smokeball appointment note needs manual follow-up",
        sessionId: "sess-1",
      })
    );
  });

  it("alerts the firm when the note Zap fails", async () => {
    mocks.getMatterForSession.mockResolvedValue({ smokeballMatterId: "SMOKE-1" });
    mocks.sendToZapier.mockRejectedValue(new Error("Zap down"));

    await expect(
      deliverAppointmentNoteToSmokeball(input, { attempts: 1, delayMs: 0 })
    ).resolves.toBe("failed");

    expect(mocks.sendFirmIntegrationAlertEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Smokeball appointment note Zap failed",
        reason: "Zap down",
        smokeballMatterId: "SMOKE-1",
      })
    );
  });
});
