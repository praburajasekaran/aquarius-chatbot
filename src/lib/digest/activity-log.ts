import { redis } from "@/lib/kv";

/**
 * Per-day activity log feeding the firm digest aggregator (Phase 6).
 * Phase 4 declares the helper + Phase 4 events; Phase 6 extends the union
 * with `upload_completed | appointment_booked | appointment_abandoned_4h | _24h`
 * and ships the aggregator + cron + digest template.
 *
 * Fully isolated (Decision 3 in 04-CONTEXT.md): a logging failure must never
 * break a payment flow, an email send, or a webhook ack.
 */

export type ActivityEvent =
  | "lead_created"
  | "payment_completed"
  | "payment_abandoned_1h"
  | "payment_abandoned_24h"
  | "unsubscribed";

const ACTIVITY_TTL_SECONDS = 14 * 24 * 3600; // 14 days = 1209600

/**
 * AEST-aware date helper: returns YYYY-MM-DD in Australia/Sydney TZ.
 * Uses Intl with the IANA zone name so AEST <-> AEDT DST transitions
 * are handled automatically.
 */
export function aestDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export async function logActivity(
  event: ActivityEvent,
  sessionId: string,
  payload?: Record<string, unknown>
): Promise<void> {
  try {
    const key = `activity:${aestDate()}`;
    const entry = JSON.stringify({
      event,
      sessionId,
      ts: new Date().toISOString(),
      payload: payload ?? {},
    });
    await redis.lpush(key, entry);
    await redis.expire(key, ACTIVITY_TTL_SECONDS);
  } catch (err) {
    console.warn("[activity] log failed", {
      event: "activity_log_failed",
      activityEvent: event,
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
