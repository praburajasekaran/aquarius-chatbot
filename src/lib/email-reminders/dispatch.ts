import { Client } from "@upstash/qstash";
import {
  writeCancelLookup,
  readCancelLookup,
  deleteCancelLookup,
} from "./state";

/**
 * v1.1 email-reminder framework — mirrors src/lib/sms/reminder.ts
 * (the v1.0 SMS reminder) for the email channel.
 *
 * - Two-key idempotency: cancel-lookup at `email-reminder:{type}:{sessionId}`,
 *   delivery NX at `email-reminder-sent:{type}:{sessionId}` (latter written
 *   by the route handler in src/app/api/webhooks/email-reminder/route.ts).
 * - Absent-env safe: missing QSTASH_TOKEN or APP_URL → warn + return,
 *   never throws (OPS-V1.1-01).
 * - Lazy Client construction: never instantiated at module top level.
 */

export type EmailReminderType =
  | "payment-abandonment-1h"
  | "payment-abandonment-24h";

export interface EmailReminderPayload {
  sessionId: string;
  type: EmailReminderType;
}

const TTL_GRACE_SECONDS = 7200; // 2h grace per INFRA-02

export async function scheduleEmailReminder(
  type: EmailReminderType,
  sessionId: string,
  delaySeconds: number
): Promise<void> {
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    console.warn(
      "[email-reminder] QSTASH_TOKEN missing — reminder scheduling skipped",
      {
        event: "email_reminder_skipped",
        reason: "no_qstash_token",
        type,
        sessionId,
      }
    );
    return;
  }

  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    console.warn(
      "[email-reminder] APP_URL missing — reminder scheduling skipped",
      {
        event: "email_reminder_skipped",
        reason: "no_app_url",
        type,
        sessionId,
      }
    );
    return;
  }

  const client = new Client({ token });
  const res = await client.publishJSON({
    url: `${appUrl}/api/webhooks/email-reminder`,
    body: { sessionId, type } satisfies EmailReminderPayload,
    delay: delaySeconds,
  });

  await writeCancelLookup(
    type,
    sessionId,
    res.messageId,
    delaySeconds + TTL_GRACE_SECONDS
  );

  console.info("[email-reminder] reminder scheduled", {
    event: "email_reminder_scheduled",
    type,
    sessionId,
    messageId: res.messageId,
  });
}

export async function cancelEmailReminder(
  type: EmailReminderType,
  sessionId: string
): Promise<void> {
  const token = process.env.QSTASH_TOKEN;
  if (!token) return;

  const messageId = await readCancelLookup(type, sessionId);
  if (!messageId) return;

  const client = new Client({ token });
  try {
    await client.messages.cancel(messageId);
    await deleteCancelLookup(type, sessionId);
    console.info("[email-reminder] reminder cancelled", {
      event: "email_reminder_cancelled",
      type,
      sessionId,
    });
  } catch (err) {
    console.warn(
      "[email-reminder] reminder cancel failed — message may have already delivered",
      {
        event: "email_reminder_cancel_failed",
        type,
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      }
    );
  }
}
