import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { getIntake } from "@/lib/intake";
import { sendBookingNotificationEmail } from "@/lib/resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CalendlyInviteePayload {
  event: string;
  payload: {
    name: string;
    email: string;
    uri: string;
    scheduled_event: {
      uri: string;
      start_time: string;
    };
    tracking?: {
      utm_content?: string;
    };
  };
}

function verifySignature(rawBody: string, header: string | null, signingKey: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const [k, v] = kv.split("=");
      return [k.trim(), (v ?? "").trim()];
    })
  );
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;

  const expected = crypto
    .createHmac("sha256", signingKey)
    .update(`${t}.${rawBody}`)
    .digest("hex");

  const a = Buffer.from(v1, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const signingKey = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
  if (!signingKey) {
    console.error("[calendly-webhook] CALENDLY_WEBHOOK_SIGNING_KEY not set");
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("calendly-webhook-signature");

  if (!verifySignature(rawBody, signature, signingKey)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let body: CalendlyInviteePayload;
  try {
    body = JSON.parse(rawBody) as CalendlyInviteePayload;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (body.event !== "invitee.created") {
    return NextResponse.json({ ok: true, ignored: body.event });
  }

  const invitee = body.payload;
  const sessionId = invitee.tracking?.utm_content ?? null;
  const intake = sessionId ? await getIntake(sessionId) : null;

  try {
    await sendBookingNotificationEmail({
      clientName: invitee.name,
      clientEmail: invitee.email,
      matterDescription: intake?.matterDescription,
      urgency: intake?.urgency,
      eventStartTime: invitee.scheduled_event.start_time,
      eventUri: invitee.scheduled_event.uri,
      inviteeUri: invitee.uri,
      stripeSessionId: intake?.stripeSessionId ?? null,
    });
  } catch (err) {
    console.error("[calendly-webhook] failed to send firm notification", err);
  }

  return NextResponse.json({ ok: true });
}
