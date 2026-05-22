import { beforeEach, describe, expect, it, vi } from "vitest";

const { getIntakeMock } = vi.hoisted(() => ({
  getIntakeMock: vi.fn(),
}));

vi.mock("@/lib/intake", () => ({
  getIntake: getIntakeMock,
}));

import { resolvePostUploadBookingStep } from "./resolve-post-upload-booking-step";

function intake(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "s_test",
    clientName: "Test Client",
    clientEmail: "test@example.com",
    clientPhone: "0412 345 678",
    matterDescription: "Traffic matter",
    urgency: "non-urgent",
    displayPrice: "$726.00",
    amountCents: 72600,
    paymentRef: "PAY-1",
    bpointAuthKey: "AUTH-1",
    createdAt: "2026-05-22T00:00:00.000Z",
    updatedAt: "2026-05-22T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolvePostUploadBookingStep", () => {
  beforeEach(() => {
    getIntakeMock.mockReset();
  });

  it("returns a session booking step for non-urgent intake", async () => {
    getIntakeMock.mockResolvedValue(intake());

    await expect(
      resolvePostUploadBookingStep({ sessionId: "s_test" })
    ).resolves.toEqual({
      kind: "session-booking",
      sessionId: "s_test",
      prefillName: "Test Client",
      prefillEmail: "test@example.com",
      matterSummary: "Traffic matter",
    });
  });

  it("does not require a matter summary for session booking", async () => {
    getIntakeMock.mockResolvedValue(intake({ matterDescription: " " }));

    await expect(
      resolvePostUploadBookingStep({ sessionId: "s_test" })
    ).resolves.toEqual({
      kind: "session-booking",
      sessionId: "s_test",
      prefillName: "Test Client",
      prefillEmail: "test@example.com",
      matterSummary: undefined,
    });
  });

  it("returns urgent contact for urgent intake", async () => {
    getIntakeMock.mockResolvedValue(intake({ urgency: "urgent" }));

    await expect(
      resolvePostUploadBookingStep({ sessionId: "s_urgent" })
    ).resolves.toEqual({
      kind: "urgent-contact",
      sessionId: "s_urgent",
    });
  });

  it("distinguishes missing intake", async () => {
    getIntakeMock.mockResolvedValue(null);

    await expect(
      resolvePostUploadBookingStep({ sessionId: "missing" })
    ).resolves.toEqual({
      kind: "unavailable",
      reason: "missing-intake",
    });
  });

  it.each([
    ["missing urgency", { urgency: undefined }],
    ["unknown urgency", { urgency: "maybe" }],
    ["missing name", { clientName: "" }],
    ["missing email", { clientEmail: " " }],
  ])("returns invalid intake for %s", async (_label, overrides) => {
    getIntakeMock.mockResolvedValue(intake(overrides));

    await expect(
      resolvePostUploadBookingStep({ sessionId: "s_test" })
    ).resolves.toEqual({
      kind: "unavailable",
      reason: "invalid-intake",
    });
  });
});
