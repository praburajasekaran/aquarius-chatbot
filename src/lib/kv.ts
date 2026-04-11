import { Redis } from "@upstash/redis";
import type { SessionData } from "@/types";

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const SESSION_TTL = 3600; // 1 hour

export function sessionKey(sessionId: string) {
  return `session:${sessionId}`;
}

export async function createSession(
  sessionId: string,
  data?: Partial<SessionData>
): Promise<SessionData> {
  const session: SessionData = {
    name: null,
    email: null,
    phone: null,
    matterType: "criminal",
    matterDescription: null,
    urgency: null,
    paymentStatus: "pending",
    paymentAmount: null,
    stripeSessionId: null,
    uploadRefs: [],
    calendlyEvent: null,
    createdAt: new Date().toISOString(),
    ...data,
  };
  await redis.set(sessionKey(sessionId), session, { ex: SESSION_TTL });
  return session;
}

export async function getSession(
  sessionId: string
): Promise<SessionData | null> {
  return redis.get<SessionData>(sessionKey(sessionId));
}

export async function updateSession(
  sessionId: string,
  data: Partial<SessionData>
): Promise<SessionData> {
  const existing = await getSession(sessionId);
  if (!existing) throw new Error("Session expired");
  const updated = { ...existing, ...data };
  await redis.set(sessionKey(sessionId), updated, { ex: SESSION_TTL });
  return updated;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await redis.del(sessionKey(sessionId));
}
