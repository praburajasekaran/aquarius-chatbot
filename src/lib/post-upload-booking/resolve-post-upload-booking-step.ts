import { getIntake, type IntakeRecord } from "@/lib/intake";
import type { PostUploadBookingStep } from "./types";

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function matterSummary(intake: IntakeRecord): string | undefined {
  return nonEmpty(intake.matterDescription)
    ? intake.matterDescription.trim()
    : undefined;
}

export async function resolvePostUploadBookingStep({
  sessionId,
}: {
  sessionId: string;
}): Promise<PostUploadBookingStep> {
  const intake = await getIntake(sessionId);

  if (!intake) {
    return { kind: "unavailable", reason: "missing-intake" };
  }

  if (intake.urgency === "urgent") {
    return { kind: "urgent-contact", sessionId };
  }

  if (intake.urgency !== "non-urgent") {
    return { kind: "unavailable", reason: "invalid-intake" };
  }

  if (!nonEmpty(intake.clientName) || !nonEmpty(intake.clientEmail)) {
    return { kind: "unavailable", reason: "invalid-intake" };
  }

  return {
    kind: "session-booking",
    sessionId,
    prefillName: intake.clientName.trim(),
    prefillEmail: intake.clientEmail.trim(),
    matterSummary: matterSummary(intake),
  };
}
