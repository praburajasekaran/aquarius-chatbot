import { redis } from "@/lib/kv";

/**
 * Session → Smokeball-matter mapping.
 *
 * Written by `/api/webhooks/smokeball-matter-created` when Zap #1's tail step
 * POSTs back after Smokeball creates a matter. Read by the late-upload flow so
 * Zap #2 knows which Smokeball matter to attach the file to.
 *
 * Keyed by our internal sessionId from BPoint checkout. Value holds
 * the Smokeball matter ID plus capture timestamp.
 *
 * TTL = 90 days. Covers realistic late-upload window for criminal matters;
 * renewed on every successful lookup via {@link touchMatterForSession}.
 */

const PREFIX = "session-matter:";
const TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

export interface SessionMatterMapping {
  smokeballMatterId: string;
  capturedAt: string;
}

export function isValidSmokeballMatterId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length > 0 &&
    normalized !== "null" &&
    normalized !== "undefined" &&
    normalized !== "none" &&
    normalized !== "n/a"
  );
}

function mappingKey(sessionId: string): string {
  return `${PREFIX}${sessionId}`;
}

export async function setMatterForSession(
  sessionId: string,
  smokeballMatterId: string
): Promise<SessionMatterMapping> {
  if (!isValidSmokeballMatterId(smokeballMatterId)) {
    throw new Error("invalid_smokeball_matter_id");
  }

  const mapping: SessionMatterMapping = {
    smokeballMatterId: smokeballMatterId.trim(),
    capturedAt: new Date().toISOString(),
  };
  await redis.set(mappingKey(sessionId), mapping, { ex: TTL_SECONDS });
  return mapping;
}

export async function getMatterForSession(
  sessionId: string
): Promise<SessionMatterMapping | null> {
  return redis.get<SessionMatterMapping>(mappingKey(sessionId));
}

/**
 * Renew the TTL on an existing mapping without changing its value. Called from
 * late-upload completion so active matters don't expire mid-lifecycle.
 */
export async function touchMatterForSession(
  sessionId: string
): Promise<SessionMatterMapping | null> {
  const mapping = await getMatterForSession(sessionId);
  if (!mapping) return null;
  await redis.set(mappingKey(sessionId), mapping, { ex: TTL_SECONDS });
  return mapping;
}

export {
  TTL_SECONDS as SESSION_MATTER_TTL,
  PREFIX as SESSION_MATTER_PREFIX,
};
