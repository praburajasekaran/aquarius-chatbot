import { Resend } from "resend";

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
