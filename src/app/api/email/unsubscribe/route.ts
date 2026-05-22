import { NextResponse, type NextRequest } from "next/server";
import { redis } from "@/lib/kv";
import { verifyUnsubscribeToken } from "@/lib/email-reminders/unsubscribe";
import {
  cancelEmailReminder,
  type EmailReminderType,
} from "@/lib/email-reminders/dispatch";
import { logActivity } from "@/lib/digest/activity-log";

/**
 * One-click unsubscribe endpoint (INFRA-07 + 04-CONTEXT.md Decision 2).
 *
 * GET `/api/email/unsubscribe?session={sessionId}&token={hmac}`
 *
 * Flow:
 *   1. Verify HMAC-SHA256 token (constant-time compare).
 *   2. Write durable opt-out: `unsubscribe:{sessionId}` with 30d TTL.
 *   3. Cancel every v1.1 reminder type for this session.
 *      (Phase 5 will extend the type list with appointment-abandonment-*.)
 *   4. Log `unsubscribed` activity (fully isolated — never throws).
 *   5. Redirect to `/unsubscribed` (branded confirmation page).
 *
 * Security: invalid token returns 400 with a minimal error body. We
 * deliberately do NOT echo the sessionId or describe why the request was
 * rejected, so a leaked URL or scraping attempt cannot probe which
 * sessionIds exist in Redis.
 */

export const runtime = "nodejs"; // node:crypto in unsubscribe HMAC needs Node runtime
export const dynamic = "force-dynamic"; // never cache the unsubscribe response

const UNSUBSCRIBE_TTL_SECONDS = 30 * 24 * 3600; // 30d = 2592000 (Decision 2)

// All v1.1 reminder types this endpoint cancels on opt-out.
// Phase 5 extends this with appointment-abandonment-* types.
const V11_REMINDER_TYPES: EmailReminderType[] = [
  "payment-abandonment-1h",
  "payment-abandonment-24h",
];

export async function GET(request: NextRequest): Promise<Response> {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session");
  const token = url.searchParams.get("token");

  // Minimal error response — do NOT echo sessionId back (Decision 2:
  // "don't leak which sessionIds exist").
  if (!sessionId || !token) {
    return new Response("Invalid request", { status: 400 });
  }

  if (!verifyUnsubscribeToken(sessionId, token)) {
    return new Response("Invalid request", { status: 400 });
  }

  // Write durable opt-out (30d TTL). Best-effort — if Redis is offline we
  // still cancel pending reminders below; the visitor's intent is honoured
  // for the in-flight reminders even if the long-lived guard fails.
  try {
    await redis.set(`unsubscribe:${sessionId}`, "1", {
      ex: UNSUBSCRIBE_TTL_SECONDS,
    });
  } catch (err) {
    console.error("[unsubscribe] redis write failed", {
      event: "unsubscribe_write_failed",
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // Cancel every v1.1 reminder for this session (Decision 2). Each cancel
  // is best-effort and isolated — one failing type must not block the others.
  for (const t of V11_REMINDER_TYPES) {
    try {
      await cancelEmailReminder(t, sessionId);
    } catch (err) {
      console.error("[unsubscribe] cancel failed", {
        event: "unsubscribe_cancel_failed",
        type: t,
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Activity log — `logActivity` is internally isolated, never throws.
  await logActivity("unsubscribed", sessionId, {});

  console.info("[unsubscribe] visitor opted out", {
    event: "unsubscribed",
    sessionId,
  });

  return NextResponse.redirect(new URL("/unsubscribed", request.url));
}
