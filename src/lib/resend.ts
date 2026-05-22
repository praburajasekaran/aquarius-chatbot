import type { CreateEmailOptions, CreateEmailResponseSuccess } from "resend";
import { Resend } from "resend";
import { BRANDING } from "@/lib/branding";
import ClientInquiryEmail from "@/lib/email/templates/client-inquiry";
import FirmBookingNotificationEmail from "@/lib/email/templates/firm-booking-notification";
import FirmLeadEmail from "@/lib/email/templates/firm-lead";
import FirmTranscriptEmail from "@/lib/email/templates/firm-transcript";

// Lazily initialized so that a missing RESEND_API_KEY at module load time
// doesn't crash routes that import this file without ever sending email.
let _resend: Resend | null = null;
function getClient(): Resend {
  return (_resend ??= new Resend(process.env.RESEND_API_KEY));
}
export const resend: Resend = new Proxy({} as Resend, {
  get(_, prop) {
    return Reflect.get(getClient(), prop);
  },
});

// The Resend SDK's `emails.send()` returns `{ data, error }` and does NOT throw
// on application-level rejections (unverified sender, suppression list, rate
// limits, schema errors). Without inspection these failures are invisible —
// the surrounding try/catch only catches transport/JS errors, so a successful
// `await` looks identical to a silently rejected send.
//
// `sendAndLog` is the single chokepoint every send must go through:
//   - logs `{event:"resend_sent", id, to, subject}` on success
//   - logs `{event:"resend_send_failed", error, to, subject}` on Resend error
//     and re-throws so existing try/catches still trigger their fallback path
export async function sendAndLog(
  payload: CreateEmailOptions,
  context: { event: string; sessionId?: string }
): Promise<CreateEmailResponseSuccess> {
  const { data, error } = await resend.emails.send(payload);
  if (error) {
    console.error("[resend] send failed", {
      event: "resend_send_failed",
      caller: context.event,
      sessionId: context.sessionId,
      to: payload.to,
      subject: payload.subject,
      error: { name: error.name, message: error.message },
    });
    throw new Error(`Resend rejected: ${error.name} — ${error.message}`);
  }
  console.info("[resend] sent", {
    event: "resend_sent",
    caller: context.event,
    sessionId: context.sessionId,
    to: payload.to,
    subject: payload.subject,
    id: data?.id,
  });
  // data is non-null when error is null per Resend SDK contract
  return data as CreateEmailResponseSuccess;
}

export async function sendTranscriptEmail({
  clientName,
  clientEmail,
  clientPhone,
  matterDescription,
  urgency,
  paymentAmount,
  paymentRef,
  transcript,
}: {
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  matterDescription: string;
  urgency: string;
  paymentAmount: number;
  paymentRef: string | null;
  transcript?: string;
}) {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) {
    console.warn(
      "[resend] RESEND_FROM_EMAIL not set — sendTranscriptEmail skipped"
    );
    return;
  }
  const to = process.env.FIRM_NOTIFY_EMAIL;
  if (!to) {
    console.error(
      "[resend] FIRM_NOTIFY_EMAIL not set — sendTranscriptEmail SKIPPED (was previously falling back to a hardcoded personal address)",
      { event: "firm_notify_email_missing", caller: "sendTranscriptEmail" }
    );
    return;
  }
  return sendAndLog(
    {
      from,
      to,
      subject: `New inquiry — ${clientName} (${urgency})`,
      react: FirmTranscriptEmail({
        clientName,
        clientEmail,
        clientPhone,
        matterDescription,
        urgency,
        paymentAmount,
        paymentRef,
        transcript,
      }),
    },
    { event: "sendTranscriptEmail", sessionId: paymentRef ?? undefined }
  );
}

export async function sendClientInquiryEmail({
  sessionId,
  clientName,
  clientEmail,
  matterDescription,
  urgency,
  displayPrice,
}: {
  sessionId: string;
  clientName: string;
  clientEmail: string;
  matterDescription: string;
  urgency: "urgent" | "non-urgent";
  displayPrice: string;
}) {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) {
    console.warn(
      "[resend] RESEND_FROM_EMAIL not set — sendClientInquiryEmail skipped"
    );
    return;
  }
  const appUrl = process.env.NEXT_PUBLIC_URL ?? "";
  const resumeUrl = `${appUrl}/api/checkout/resume?session=${encodeURIComponent(sessionId)}`;
  const calendlyUrl = process.env.CALENDLY_BOOKING_URL;
  if (!calendlyUrl) {
    throw new Error("CALENDLY_BOOKING_URL not set");
  }
  const calendlyPrefillUrl = `${calendlyUrl}?name=${encodeURIComponent(clientName)}&email=${encodeURIComponent(clientEmail)}`;

  const subjectMatterLabel =
    urgency === "urgent"
      ? "Initial Deposit for Urgent Court Matter"
      : "Legal Strategy Session";

  return sendAndLog(
    {
      from,
      to: clientEmail,
      subject: `Your ${subjectMatterLabel} inquiry — ${BRANDING.firmName}`,
      react: ClientInquiryEmail({
        clientName,
        matterDescription,
        urgency,
        displayPrice,
        resumeUrl,
        calendlyPrefillUrl,
        calendlyUrl,
      }),
    },
    { event: "sendClientInquiryEmail", sessionId }
  );
}

export async function sendFirmLeadEmail({
  clientName,
  clientEmail,
  clientPhone,
  matterDescription,
  urgency,
  displayPrice,
  resumeUrl,
  transcript,
}: {
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  matterDescription: string;
  urgency: "urgent" | "non-urgent";
  displayPrice: string;
  resumeUrl: string;
  transcript?: string;
}) {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) {
    console.warn(
      "[resend] RESEND_FROM_EMAIL not set — sendFirmLeadEmail skipped"
    );
    return;
  }
  const to = process.env.FIRM_NOTIFY_EMAIL;
  if (!to) {
    console.error(
      "[resend] FIRM_NOTIFY_EMAIL not set — sendFirmLeadEmail SKIPPED",
      { event: "firm_notify_email_missing", caller: "sendFirmLeadEmail" }
    );
    return;
  }
  return sendAndLog(
    {
      from,
      to,
      subject: `New lead — ${clientName} (awaiting payment)`,
      react: FirmLeadEmail({
        clientName,
        clientEmail,
        clientPhone,
        matterDescription,
        urgency,
        displayPrice,
        resumeUrl,
        transcript,
      }),
    },
    { event: "sendFirmLeadEmail" }
  );
}

export async function sendBookingNotificationEmail({
  clientName,
  clientEmail,
  matterDescription,
  urgency,
  eventStartTime,
  eventUri,
  inviteeUri,
  paymentRef,
}: {
  clientName: string;
  clientEmail: string;
  matterDescription?: string;
  urgency?: "urgent" | "non-urgent";
  eventStartTime: string;
  eventUri: string;
  inviteeUri: string;
  paymentRef?: string | null;
}) {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) {
    console.warn(
      "[resend] RESEND_FROM_EMAIL not set — sendBookingNotificationEmail skipped"
    );
    return;
  }
  const to = process.env.FIRM_NOTIFY_EMAIL;
  if (!to) {
    console.error(
      "[resend] FIRM_NOTIFY_EMAIL not set — sendBookingNotificationEmail SKIPPED",
      {
        event: "firm_notify_email_missing",
        caller: "sendBookingNotificationEmail",
      }
    );
    return;
  }

  let startLocal = eventStartTime;
  try {
    startLocal = new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Sydney",
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(eventStartTime));
  } catch {
    // fall back to raw ISO string if parsing fails
  }

  return sendAndLog(
    {
      from,
      to,
      subject: `Booking confirmed — ${clientName} (${startLocal})`,
      react: FirmBookingNotificationEmail({
        clientName,
        clientEmail,
        matterDescription,
        urgency,
        startTimeLocal: startLocal,
        eventUri,
        inviteeUri,
        paymentRef,
      }),
    },
    {
      event: "sendBookingNotificationEmail",
      sessionId: paymentRef ?? undefined,
    }
  );
}
