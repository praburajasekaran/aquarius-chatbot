import { Resend } from "resend";
import { FIRM_CONTACT } from "@/lib/contact";

export const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendTranscriptEmail({
  clientName,
  clientEmail,
  clientPhone,
  matterDescription,
  urgency,
  paymentAmount,
  stripeSessionId,
  transcript,
}: {
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  matterDescription: string;
  urgency: string;
  paymentAmount: number;
  stripeSessionId: string | null;
  transcript: string;
}) {
  return resend.emails.send({
    from: "Aquarius Chatbot <chatbot@aquariuslawyers.com.au>",
    to: "info@aquariuslawyers.com.au",
    subject: `New ${urgency} Criminal Law Inquiry — ${clientName}`,
    html: `
      <h2>New Client Inquiry</h2>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Name</td><td style="padding:8px;border:1px solid #ddd">${clientName}</td></tr>
        <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Email</td><td style="padding:8px;border:1px solid #ddd">${clientEmail}</td></tr>
        <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Phone</td><td style="padding:8px;border:1px solid #ddd">${clientPhone}</td></tr>
        <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Matter</td><td style="padding:8px;border:1px solid #ddd">${matterDescription}</td></tr>
        <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Urgency</td><td style="padding:8px;border:1px solid #ddd">${urgency}</td></tr>
        <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Payment</td><td style="padding:8px;border:1px solid #ddd">$${(paymentAmount / 100).toFixed(2)} AUD</td></tr>
        <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Stripe Session</td><td style="padding:8px;border:1px solid #ddd">${stripeSessionId ?? "N/A"}</td></tr>
      </table>
      <h3>Chat Transcript</h3>
      <div style="background:#f5f5f5;padding:16px;border-radius:8px;white-space:pre-wrap;font-family:sans-serif;font-size:14px">${transcript}</div>
    `,
  });
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
  const appUrl = process.env.NEXT_PUBLIC_URL ?? "";
  const resumeUrl = `${appUrl}/api/checkout/resume?session=${encodeURIComponent(sessionId)}`;
  const calendlyUrl =
    process.env.CALENDLY_BOOKING_URL ??
    "https://calendly.com/ekalaivan/advising-meeting";
  const calendlyPrefillUrl = `${calendlyUrl}?name=${encodeURIComponent(clientName)}&email=${encodeURIComponent(clientEmail)}`;

  const urgentBlock = `
    <p style="margin:16px 0;font-size:15px;line-height:1.5">
      For urgent matters, please call us on
      <a href="${FIRM_CONTACT.phoneHref}" style="color:#085a66;font-weight:600">${FIRM_CONTACT.phone}</a>
      during our business hours (<strong>${FIRM_CONTACT.businessHours}</strong>).
      We'll be ready to help as soon as we hear from you.
    </p>
  `;

  const nonUrgentBlock = `
    <p style="margin:16px 0;font-size:15px;line-height:1.5">
      For non-urgent matters, we'll schedule your Legal Strategy Session via Calendly.
      You can pick a slot at any time here:
      <br />
      <a href="${calendlyPrefillUrl}" style="color:#085a66;font-weight:600">${calendlyUrl}</a>
    </p>
  `;

  const paymentBlock = `
    <p style="margin:24px 0">
      <a
        href="${resumeUrl}"
        style="display:inline-block;background:#61BBCA;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600"
      >Complete payment — ${displayPrice}</a>
    </p>
    <p style="margin:8px 0;font-size:13px;color:#555">
      If you've already paid, this link will take you to a confirmation page instead.
    </p>
  `;

  return resend.emails.send({
    from: "Aquarius Chatbot <chatbot@aquariuslawyers.com.au>",
    to: clientEmail,
    subject: "Your Legal Strategy Session inquiry — Aquarius Lawyers",
    html: `
      <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a">
        <h2 style="margin:0 0 16px;font-size:20px">Hi ${clientName},</h2>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.5">
          Thanks for your inquiry with Aquarius Lawyers. Here's a quick summary of what you shared with us:
        </p>
        <table style="border-collapse:collapse;width:100%;margin:16px 0">
          <tr><td style="padding:8px;border:1px solid #e5e5e5;font-weight:600;width:35%">Matter</td><td style="padding:8px;border:1px solid #e5e5e5">${matterDescription}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e5e5e5;font-weight:600">Urgency</td><td style="padding:8px;border:1px solid #e5e5e5">${urgency}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e5e5e5;font-weight:600">Fee</td><td style="padding:8px;border:1px solid #e5e5e5">${displayPrice}</td></tr>
        </table>
        ${paymentBlock}
        ${urgency === "urgent" ? urgentBlock : nonUrgentBlock}
        <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0" />
        <p style="margin:0;font-size:12px;color:#777;line-height:1.5">
          This email was sent by the Aquarius Lawyers chatbot in response to your inquiry.
          Aquarius Lawyers provides general information only — not legal advice. Reply to this
          email if you have any questions.
        </p>
      </div>
    `,
  });
}

export async function sendBookingNotificationEmail({
  clientName,
  clientEmail,
  matterDescription,
  urgency,
  eventStartTime,
  eventUri,
  inviteeUri,
  stripeSessionId,
}: {
  clientName: string;
  clientEmail: string;
  matterDescription?: string;
  urgency?: "urgent" | "non-urgent";
  eventStartTime: string;
  eventUri: string;
  inviteeUri: string;
  stripeSessionId?: string | null;
}) {
  const to = process.env.FIRM_NOTIFICATION_EMAIL ?? "prabu@paretoid.com";

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

  return resend.emails.send({
    from: "Aquarius Chatbot <chatbot@aquariuslawyers.com.au>",
    to,
    subject: `Booking confirmed — ${clientName} — ${startLocal}`,
    html: `
      <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a">
        <h2 style="margin:0 0 16px;font-size:20px">New Legal Strategy Session booking</h2>
        <table style="border-collapse:collapse;width:100%;margin:16px 0">
          <tr><td style="padding:8px;border:1px solid #e5e5e5;font-weight:600;width:35%">Client</td><td style="padding:8px;border:1px solid #e5e5e5">${clientName}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e5e5e5;font-weight:600">Email</td><td style="padding:8px;border:1px solid #e5e5e5">${clientEmail}</td></tr>
          ${urgency ? `<tr><td style="padding:8px;border:1px solid #e5e5e5;font-weight:600">Urgency</td><td style="padding:8px;border:1px solid #e5e5e5">${urgency}</td></tr>` : ""}
          ${matterDescription ? `<tr><td style="padding:8px;border:1px solid #e5e5e5;font-weight:600">Matter</td><td style="padding:8px;border:1px solid #e5e5e5">${matterDescription}</td></tr>` : ""}
          <tr><td style="padding:8px;border:1px solid #e5e5e5;font-weight:600">Start time</td><td style="padding:8px;border:1px solid #e5e5e5">${startLocal}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e5e5e5;font-weight:600">Calendly event</td><td style="padding:8px;border:1px solid #e5e5e5"><a href="${eventUri}">${eventUri}</a></td></tr>
          <tr><td style="padding:8px;border:1px solid #e5e5e5;font-weight:600">Calendly invitee</td><td style="padding:8px;border:1px solid #e5e5e5"><a href="${inviteeUri}">${inviteeUri}</a></td></tr>
          ${stripeSessionId ? `<tr><td style="padding:8px;border:1px solid #e5e5e5;font-weight:600">Stripe session</td><td style="padding:8px;border:1px solid #e5e5e5">${stripeSessionId}</td></tr>` : ""}
        </table>
      </div>
    `,
  });
}
