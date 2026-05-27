import type { IntakeRecord } from "@/lib/intake";

const STOP_WORDS = new Set([
  "a",
  "about",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "being",
  "by",
  "for",
  "from",
  "had",
  "has",
  "have",
  "having",
  "i",
  "in",
  "into",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "regarding",
  "re",
  "the",
  "their",
  "they",
  "this",
  "to",
  "was",
  "we",
  "with",
]);

export interface BuildCreateMatterPayloadArgs {
  sessionId: string;
  paymentRef: string;
  paymentAmount: number;
  intake: IntakeRecord;
}

export interface CreateMatterZapPayload {
  event: "paid_intake.create_matter";
  matter_ref: string;
  session_id: string;
  payment_ref: string;
  payment_amount_cents: number;
  client_name: string;
  client_email: string;
  client_phone: string;
  urgency: IntakeRecord["urgency"];
  matter_summary: string;
  matter_title: string;
  display_price: string;
  paid_at: string;
  source: "chatbot/paid-intake";
  isTest: boolean;
}

export function buildMatterTitle(
  clientName: string,
  matterSummary: string
): string {
  const usefulWords = matterSummary
    .split(/\s+/)
    .map((word) => word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ""))
    .filter(Boolean)
    .filter((word) => !STOP_WORDS.has(word.toLowerCase()))
    .slice(0, 4);

  const summaryPart =
    usefulWords.length > 0 ? usefulWords.join(" ") : "Legal matter";
  const namePart = clientName.trim() || "Client";
  return `${namePart} - ${summaryPart}`;
}

export function buildCreateMatterZapPayload({
  sessionId,
  paymentRef,
  paymentAmount,
  intake,
}: BuildCreateMatterPayloadArgs): CreateMatterZapPayload {
  return {
    event: "paid_intake.create_matter",
    matter_ref: sessionId,
    session_id: sessionId,
    payment_ref: paymentRef,
    payment_amount_cents: paymentAmount,
    client_name: intake.clientName,
    client_email: intake.clientEmail,
    client_phone: intake.clientPhone,
    urgency: intake.urgency,
    matter_summary: intake.matterDescription,
    matter_title: buildMatterTitle(intake.clientName, intake.matterDescription),
    display_price: intake.displayPrice,
    paid_at: new Date().toISOString(),
    source: "chatbot/paid-intake",
    isTest: process.env.NODE_ENV !== "production",
  };
}
