import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  buildCreateMatterZapPayload,
  buildMatterTitle,
} from "@/lib/smokeball/create-matter";
import type { IntakeRecord } from "@/lib/intake";

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

describe("Smokeball create-matter payload", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T04:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds a deterministic matter title from client name and useful summary words", () => {
    expect(
      buildMatterTitle(
        "Taylor Smith",
        "I need help with an urgent assault charge in court"
      )
    ).toBe("Taylor Smith - need help urgent assault");
  });

  it("builds the create-matter payload without transcript content", () => {
    const payload = buildCreateMatterZapPayload({
      sessionId: "sess-1",
      paymentRef: "BPOINT-1",
      paymentAmount: 132000,
      intake: intake(),
    });

    expect(payload).toMatchObject({
      event: "paid_intake.create_matter",
      matter_ref: "sess-1",
      session_id: "sess-1",
      payment_ref: "BPOINT-1",
      payment_amount_cents: 132000,
      client_name: "Taylor Smith",
      client_email: "taylor@example.com",
      client_phone: "0400000000",
      urgency: "urgent",
      matter_summary: "I need help with an urgent assault charge in court",
      matter_title: "Taylor Smith - need help urgent assault",
      display_price: "$1,320",
      paid_at: "2026-05-22T04:30:00.000Z",
      source: "chatbot/paid-intake",
    });
    expect(JSON.stringify(payload).toLowerCase()).not.toContain("transcript");
  });
});
