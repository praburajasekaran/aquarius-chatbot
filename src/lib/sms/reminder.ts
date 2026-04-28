import { Client } from "@upstash/qstash";
import { redis } from "@/lib/kv";

const REMINDER_DELAY_SECONDS = 86400;       // 24 hours
const REMINDER_KEY_TTL_SECONDS = 26 * 3600; // 26 hours = 93600

function reminderKey(sessionId: string): string {
  return `sms-reminder:${sessionId}`;
}

export async function scheduleReminderSms(
  sessionId: string,
  phone: string,
  uploadLink: string
): Promise<void> {
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    console.warn("[sms] QSTASH_TOKEN missing — reminder scheduling skipped", {
      event: "reminder_skipped",
      reason: "no_qstash_token",
      sessionId,
    });
    return;
  }

  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    console.warn("[sms] APP_URL missing — reminder scheduling skipped", {
      event: "reminder_skipped",
      reason: "no_app_url",
      sessionId,
    });
    return;
  }

  const client = new Client({ token });
  const res = await client.publishJSON({
    url: `${appUrl}/api/webhooks/sms-reminder`,
    body: { sessionId, phone, uploadLink },
    delay: REMINDER_DELAY_SECONDS,
  });

  await redis.set(reminderKey(sessionId), res.messageId, {
    ex: REMINDER_KEY_TTL_SECONDS,
  });

  console.info("[sms] reminder scheduled", {
    event: "reminder_scheduled",
    sessionId,
    messageId: res.messageId,
  });
}

export async function cancelPendingReminder(sessionId: string): Promise<void> {
  const token = process.env.QSTASH_TOKEN;
  if (!token) return;

  const messageId = await redis.get<string>(reminderKey(sessionId));
  if (!messageId) return;

  const client = new Client({ token });
  try {
    await client.messages.cancel(messageId);
    await redis.del(reminderKey(sessionId));
    console.info("[sms] reminder cancelled", {
      event: "reminder_cancelled",
      sessionId,
    });
  } catch (err) {
    console.warn("[sms] reminder cancel failed — message may have already delivered", {
      event: "reminder_cancel_failed",
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
