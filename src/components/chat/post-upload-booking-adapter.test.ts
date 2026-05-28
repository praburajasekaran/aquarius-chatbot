import { describe, expect, it } from "vitest";
import { postUploadBookingStepToChatMessage } from "./post-upload-booking-adapter";

describe("postUploadBookingStepToChatMessage", () => {
  it("maps session booking to the schedule appointment tool part", () => {
    expect(
      postUploadBookingStepToChatMessage(
        {
          kind: "session-booking",
          sessionId: "s_test",
          prefillName: "Test Client",
          prefillEmail: "test@example.com",
          matterSummary: "Traffic matter",
        },
        "fixed"
      )
    ).toEqual({
      id: "post_upload_schedule_fixed",
      role: "assistant",
      parts: [
        {
          type: "tool-scheduleAppointment",
          state: "input-available",
          toolCallId: "post_upload_schedule_fixed",
          input: {
            sessionId: "s_test",
            prefillName: "Test Client",
            prefillEmail: "test@example.com",
            matterDescription: "Traffic matter",
          },
        },
      ],
    });
  });

  it("uses an empty matter description when the matter summary is absent", () => {
    const message = postUploadBookingStepToChatMessage(
      {
        kind: "session-booking",
        sessionId: "s_test",
        prefillName: "Test Client",
        prefillEmail: "test@example.com",
      },
      "fixed"
    );

    expect(message.parts[0]).toMatchObject({
      input: { matterDescription: "" },
    });
  });

  it("maps urgent contact to the urgent contact tool part", () => {
    expect(
      postUploadBookingStepToChatMessage(
        { kind: "urgent-contact", sessionId: "s_urgent" },
        "fixed"
      )
    ).toEqual({
      id: "post_upload_urgent_fixed",
      role: "assistant",
      parts: [
        {
          type: "tool-showUrgentContact",
          state: "input-available",
          toolCallId: "post_upload_urgent_fixed",
          input: { sessionId: "s_urgent" },
        },
      ],
    });
  });

  it("maps unavailable to visitor-facing fallback text", () => {
    expect(
      postUploadBookingStepToChatMessage({ kind: "unavailable" }, "fixed")
    ).toEqual({
      id: "post_upload_unavailable_fixed",
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "Thanks — your documents were submitted, but the next step is temporarily unavailable. Please contact Aquarius Lawyers directly on +61 2 8858 3233.",
        },
      ],
    });
  });

  it("includes a direct booking link when the widget handoff is unavailable for a non-urgent visitor", () => {
    expect(
      postUploadBookingStepToChatMessage(
        { kind: "unavailable" },
        "fixed",
        "https://calendly.test/book"
      )
    ).toEqual({
      id: "post_upload_unavailable_fixed",
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "Thanks — your documents were submitted. If the booking widget does not appear, please book your Legal Strategy Session here: https://calendly.test/book. You can also contact Aquarius Lawyers directly on +61 2 8858 3233.",
        },
      ],
    });
  });
});
