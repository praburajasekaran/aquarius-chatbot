import type { IntakeRecord } from "@/lib/intake";
import { sendFirmIntegrationAlertEmail } from "@/lib/resend";
import { getMatterForSession } from "@/lib/session-matter-map";
import { sendToZapier } from "@/lib/zapier";

export interface AppointmentNoteInput {
  sessionId: string;
  clientName: string;
  clientEmail: string;
  eventStartTime: string;
  eventUri: string;
  inviteeUri: string;
  intake: IntakeRecord | null;
}

export interface AppointmentNoteWaitOptions {
  attempts?: number;
  delayMs?: number;
}

export interface AppointmentNoteZapPayload {
  event: "booking.appointment_note";
  matter_ref: string;
  session_id: string;
  smokeball_matter_id: string;
  smokeball_note_target: "matter";
  client_name: string;
  client_email: string;
  appointment_start_time: string;
  appointment_start_time_local: string;
  appointment_time_zone: "Australia/Sydney";
  calendly_event_uri: string;
  calendly_invitee_uri: string;
  payment_ref: string | null;
  matter_note_title: string;
  matter_note_body: string;
  note: string;
  source: "chatbot/calendly";
  isTest: boolean;
}

const DEFAULT_ATTEMPTS = 5;
const DEFAULT_DELAY_MS = 750;

export function formatSydneyTime(isoTime: string): string {
  try {
    return new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Sydney",
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(isoTime));
  } catch {
    return isoTime;
  }
}

export function formatSydneyDate(isoTime: string): string {
  try {
    return new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Sydney",
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(isoTime));
  } catch {
    return isoTime;
  }
}

export function formatSydneyClockTime(isoTime: string): string {
  try {
    return new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Sydney",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(isoTime));
  } catch {
    return isoTime;
  }
}

export function buildAppointmentNoteZapPayload(
  input: AppointmentNoteInput,
  smokeballMatterId: string
): AppointmentNoteZapPayload {
  const startLocal = formatSydneyTime(input.eventStartTime);
  const appointmentDate = formatSydneyDate(input.eventStartTime);
  const appointmentTime = formatSydneyClockTime(input.eventStartTime);
  const matterNoteTitle = "Legal Strategy Session booked";
  const matterNoteBody = [
    `Legal Strategy Session booked for ${startLocal}.`,
    `Appointment date: ${appointmentDate}`,
    `Appointment time: ${appointmentTime} Australia/Sydney`,
    `Client: ${input.clientName} <${input.clientEmail}>`,
    `Appointment start (UTC): ${input.eventStartTime}`,
    `Calendly event: ${input.eventUri}`,
    `Calendly invitee: ${input.inviteeUri}`,
    `Payment reference: ${input.intake?.paymentRef ?? "not captured"}`,
    `Session ID: ${input.sessionId}`,
  ].join("\n");

  return {
    event: "booking.appointment_note",
    matter_ref: input.sessionId,
    session_id: input.sessionId,
    smokeball_matter_id: smokeballMatterId,
    smokeball_note_target: "matter",
    client_name: input.clientName,
    client_email: input.clientEmail,
    appointment_start_time: input.eventStartTime,
    appointment_start_time_local: startLocal,
    appointment_time_zone: "Australia/Sydney",
    calendly_event_uri: input.eventUri,
    calendly_invitee_uri: input.inviteeUri,
    payment_ref: input.intake?.paymentRef ?? null,
    matter_note_title: matterNoteTitle,
    matter_note_body: matterNoteBody,
    note: matterNoteBody,
    source: "chatbot/calendly",
    isTest: process.env.NODE_ENV !== "production",
  };
}

export async function waitForMatterMapping(
  sessionId: string,
  options: AppointmentNoteWaitOptions = {}
): Promise<string | null> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const mapping = await getMatterForSession(sessionId).catch((err) => {
      console.error("[appointment-note] matter mapping lookup threw", {
        event: "appointment_note_mapping_lookup_failed",
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    });
    if (mapping?.smokeballMatterId) return mapping.smokeballMatterId;
    if (attempt < attempts - 1) await sleep(delayMs);
  }

  return null;
}

export async function deliverAppointmentNoteToSmokeball(
  input: AppointmentNoteInput,
  waitOptions?: AppointmentNoteWaitOptions
): Promise<"ok" | "skipped" | "failed"> {
  const url = process.env.ZAPIER_APPOINTMENT_NOTE_WEBHOOK_URL;
  const smokeballMatterId = await waitForMatterMapping(
    input.sessionId,
    waitOptions
  );

  if (!smokeballMatterId) {
    console.error("[appointment-note] no Smokeball matter mapping after wait", {
      event: "appointment_note_mapping_missing",
      sessionId: input.sessionId,
    });
    await alertFirm(input, {
      title: "Smokeball appointment note needs manual follow-up",
      reason: "No Smokeball matter mapping was captured before the retry window ended.",
    });
    return "skipped";
  }

  if (!url) {
    console.error("[appointment-note] webhook URL not configured", {
      event: "appointment_note_webhook_missing",
      sessionId: input.sessionId,
      smokeballMatterId,
    });
    await alertFirm(input, {
      title: "Smokeball appointment note Zap is not configured",
      reason: "ZAPIER_APPOINTMENT_NOTE_WEBHOOK_URL is missing.",
      smokeballMatterId,
    });
    return "failed";
  }

  const payload = buildAppointmentNoteZapPayload(input, smokeballMatterId);
  try {
    await sendToZapier(url, payload);
    console.info("[appointment-note] Zap delivered", {
      event: "appointment_note_zap_delivered",
      sessionId: input.sessionId,
      smokeballMatterId,
    });
    return "ok";
  } catch (err) {
    console.error("[appointment-note] Zap failed", {
      event: "appointment_note_zap_failed",
      sessionId: input.sessionId,
      smokeballMatterId,
      err: err instanceof Error ? err.message : String(err),
    });
    await alertFirm(input, {
      title: "Smokeball appointment note Zap failed",
      reason: err instanceof Error ? err.message : String(err),
      smokeballMatterId,
    });
    return "failed";
  }
}

async function alertFirm(
  input: AppointmentNoteInput,
  args: { title: string; reason: string; smokeballMatterId?: string }
) {
  try {
    await sendFirmIntegrationAlertEmail({
      title: args.title,
      reason: args.reason,
      sessionId: input.sessionId,
      clientName: input.clientName,
      clientEmail: input.clientEmail,
      smokeballMatterId: args.smokeballMatterId,
      details: {
        "Appointment start": input.eventStartTime,
        "Calendly event": input.eventUri,
        "Calendly invitee": input.inviteeUri,
      },
    });
  } catch (err) {
    console.error("[appointment-note] firm alert failed", {
      event: "appointment_note_alert_failed",
      sessionId: input.sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
