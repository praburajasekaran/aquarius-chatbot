import { FIRM_CONTACT } from "@/lib/contact";
import type { ChatMessage } from "@/lib/tools";
import type { PublicPostUploadBookingStep } from "@/lib/post-upload-booking/types";

function stamp() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function postUploadBookingStepToChatMessage(
  step: PublicPostUploadBookingStep,
  idSuffix: string = stamp(),
  fallbackBookingUrl?: string | null
): ChatMessage {
  if (step.kind === "session-booking") {
    const id = `post_upload_schedule_${idSuffix}`;
    return {
      id,
      role: "assistant",
      parts: [
        {
          type: "tool-scheduleAppointment",
          state: "input-available",
          toolCallId: id,
          input: {
            sessionId: step.sessionId,
            prefillName: step.prefillName,
            prefillEmail: step.prefillEmail,
            matterDescription: step.matterSummary ?? "",
          },
        },
      ],
    };
  }

  if (step.kind === "urgent-contact") {
    const id = `post_upload_urgent_${idSuffix}`;
    return {
      id,
      role: "assistant",
      parts: [
        {
          type: "tool-showUrgentContact",
          state: "input-available",
          toolCallId: id,
          input: { sessionId: step.sessionId },
        },
      ],
    };
  }

  return {
    id: `post_upload_unavailable_${idSuffix}`,
    role: "assistant",
    parts: [
      {
        type: "text",
        text: fallbackBookingUrl
          ? `Thanks — your documents were submitted. If the booking widget does not appear, please book your Legal Strategy Session here: ${fallbackBookingUrl}. You can also contact Aquarius Lawyers directly on ${FIRM_CONTACT.phone}.`
          : `Thanks — your documents were submitted, but the next step is temporarily unavailable. Please contact Aquarius Lawyers directly on ${FIRM_CONTACT.phone}.`,
      },
    ],
  };
}
