export type UnavailablePostUploadBookingReason =
  | "missing-intake"
  | "invalid-intake";

export type PostUploadBookingStep =
  | {
      kind: "session-booking";
      sessionId: string;
      prefillName: string;
      prefillEmail: string;
      matterSummary?: string;
    }
  | {
      kind: "urgent-contact";
      sessionId: string;
    }
  | {
      kind: "unavailable";
      reason: UnavailablePostUploadBookingReason;
    };

export type PublicPostUploadBookingStep =
  | Exclude<PostUploadBookingStep, { kind: "unavailable" }>
  | { kind: "unavailable" };
