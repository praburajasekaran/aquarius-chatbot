import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { redis } from "@/lib/kv";
import { sendSms } from "@/lib/sms/dispatch";
import { REMINDER_SMS_COPY } from "@/lib/sms/copy";

const REMINDER_SENT_TTL_SECONDS = 26 * 3600; // 26 hours = 93600

interface ReminderPayload {
  sessionId: string;
  phone: string;
  uploadLink: string;
}

export async function handleReminderDelivery(
  req: Request
): Promise<Response> {
  const { sessionId, phone, uploadLink } =
    (await req.json()) as ReminderPayload;

  // SCHED-03: durable upload-flag guard
  // (session TTL=6h, reminder fires at 24h — getSession() would always be null)
  const uploaded = await redis.get<string>(`uploaded:${sessionId}`);
  if (uploaded) {
    console.info("[sms] reminder skipped — already uploaded", {
      event: "reminder_skipped_uploaded",
      sessionId,
    });
    return new Response("skipped");
  }

  // SCHED-05: NX dedup against duplicate QStash deliveries
  // Separate key from `sms-reminder:{sessionId}` (cancel-lookup key) — see 02-RESEARCH.md Pitfall 1
  const sentKey = `sms-reminder-sent:${sessionId}`;
  const set = await redis.set(sentKey, "1", {
    nx: true,
    ex: REMINDER_SENT_TTL_SECONDS,
  });
  if (!set) {
    console.info("[sms] reminder skipped — already delivered", {
      event: "reminder_skipped_deduped",
      sessionId,
    });
    return new Response("deduped");
  }

  await sendSms(phone, REMINDER_SMS_COPY(uploadLink));
  console.info("[sms] reminder delivered", {
    event: "reminder_delivered",
    sessionId,
  });

  return new Response("ok");
}

// SCHED-02: every real POST is verified against QStash signing keys
// (QSTASH_CURRENT_SIGNING_KEY + QSTASH_NEXT_SIGNING_KEY).
//
// LAZY WRAPPING (PHASE-03): verifySignatureAppRouter() reads the signing
// keys synchronously and throws if either is missing. Calling it at module
// load makes Next.js's "collect page data" build step crash on PR previews
// and local dev when the keys aren't set, violating the project-wide
// "absent-safe env var" principle (.planning/STATE.md → Critical Constraints).
// We defer construction to first request and memoise the result.
let cachedHandler: ((req: Request) => Promise<Response>) | null = null;

export async function POST(req: Request): Promise<Response> {
  if (!cachedHandler) {
    cachedHandler = verifySignatureAppRouter(handleReminderDelivery);
  }
  return cachedHandler(req);
}
