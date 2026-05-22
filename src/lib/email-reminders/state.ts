import { redis } from "@/lib/kv";
import type { EmailReminderType } from "./dispatch";

/**
 * Redis key helpers for the Phase 4 email-reminder framework.
 *
 * Two-key idempotency contract (04-CONTEXT.md Decision 6):
 *   - `email-reminder:{type}:{sessionId}` — cancel-lookup, TTL = delaySeconds + 7200
 *   - `email-reminder-sent:{type}:{sessionId}` — delivery NX dedup, TTL = 7d
 *
 * Plus two delivery-time gates (INFRA-04):
 *   - `payment-completed:{sessionId}` — read by route handler, written by handlePaid
 *   - `unsubscribe:{sessionId}` — read by route handler, written by unsubscribe API
 */

export function cancelLookupKey(
  type: EmailReminderType,
  sessionId: string
): string {
  return `email-reminder:${type}:${sessionId}`;
}

export function deliveryNxKey(
  type: EmailReminderType,
  sessionId: string
): string {
  return `email-reminder-sent:${type}:${sessionId}`;
}

export async function writeCancelLookup(
  type: EmailReminderType,
  sessionId: string,
  messageId: string,
  ttlSeconds: number
): Promise<void> {
  await redis.set(cancelLookupKey(type, sessionId), messageId, {
    ex: ttlSeconds,
  });
}

export async function readCancelLookup(
  type: EmailReminderType,
  sessionId: string
): Promise<string | null> {
  return redis.get<string>(cancelLookupKey(type, sessionId));
}

export async function deleteCancelLookup(
  type: EmailReminderType,
  sessionId: string
): Promise<void> {
  await redis.del(cancelLookupKey(type, sessionId));
}

export async function tryClaimDelivery(
  type: EmailReminderType,
  sessionId: string,
  ttlSeconds: number
): Promise<boolean> {
  const result = await redis.set(deliveryNxKey(type, sessionId), "1", {
    nx: true,
    ex: ttlSeconds,
  });
  return result === "OK";
}

export async function isPaymentCompleted(
  sessionId: string
): Promise<boolean> {
  const v = await redis.get<string>(`payment-completed:${sessionId}`);
  return Boolean(v);
}

export async function isUnsubscribed(sessionId: string): Promise<boolean> {
  const v = await redis.get<string>(`unsubscribe:${sessionId}`);
  return Boolean(v);
}
