import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * One-click unsubscribe token: HMAC-SHA256 of the sessionId, base64url-encoded.
 * No expiry on the token (Decision 2 of 04-CONTEXT.md). The Redis key
 * `unsubscribe:{sessionId}` carries a 30-day TTL — that's the actual opt-out
 * lifecycle, not the token validity.
 *
 * Absent secret → sign returns null + warns, verify returns false + warns.
 * Matches OPS-V1.1-01 graceful-degradation discipline.
 */

function getSecret(): string | null {
  const secret = process.env.EMAIL_REMINDER_UNSUBSCRIBE_SECRET;
  return secret && secret.length > 0 ? secret : null;
}

export function signUnsubscribeToken(sessionId: string): string | null {
  const secret = getSecret();
  if (!secret) {
    console.warn(
      "[unsubscribe] EMAIL_REMINDER_UNSUBSCRIBE_SECRET missing — sign returning null",
      { event: "unsubscribe_secret_missing", sessionId }
    );
    return null;
  }
  return createHmac("sha256", secret).update(sessionId).digest("base64url");
}

export function verifyUnsubscribeToken(
  sessionId: string,
  token: string
): boolean {
  const secret = getSecret();
  if (!secret) {
    console.warn(
      "[unsubscribe] EMAIL_REMINDER_UNSUBSCRIBE_SECRET missing — verify returning false",
      { event: "unsubscribe_secret_missing", sessionId }
    );
    return false;
  }
  try {
    const expected = createHmac("sha256", secret)
      .update(sessionId)
      .digest("base64url");
    const expectedBuf = Buffer.from(expected, "utf8");
    const providedBuf = Buffer.from(token ?? "", "utf8");
    if (expectedBuf.length !== providedBuf.length) return false;
    return timingSafeEqual(expectedBuf, providedBuf);
  } catch {
    return false;
  }
}
