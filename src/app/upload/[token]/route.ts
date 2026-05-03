import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { resolveUploadToken } from "@/lib/upload-tokens";
import { getLimiter } from "@/lib/rate-limit";
import {
  signCookie,
  COOKIE_NAME,
  COOKIE_MAX_AGE_SECONDS,
} from "@/lib/upload-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /upload/{token}
 *
 * Resolves the one-shot upload token, mints a short-lived signed session
 * cookie, and redirects to /upload/session where the actual upload UI
 * renders.
 *
 * Implemented as a Route Handler (not a Server Component page) because
 * Next.js 15 disallows cookie mutation in Server Components — only
 * Route Handlers and Server Actions can call `cookies().set()`. The
 * previous `page.tsx` did the same logic but threw at runtime:
 *   "Cookies can only be modified in a Server Action or Route Handler."
 *
 * Failure modes (all degrade to 404 — never reveal whether the token
 * existed, was rate-limited, or had a missing IP):
 *   - No `x-forwarded-for` header
 *   - Rate limit hit
 *   - Token absent / expired in Redis
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (!ip) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { success } = await getLimiter.limit(ip);
  if (!success)
    return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { token } = await params;
  const resolved = await resolveUploadToken(token);
  if (!resolved)
    return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { record, tokenHash } = resolved;
  const exp = Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE_SECONDS;

  const sessionUrl = new URL("/upload/session", req.url);
  const response = NextResponse.redirect(sessionUrl);
  response.cookies.set(
    COOKIE_NAME,
    signCookie({
      matterRef: record.matterRef,
      sessionId: record.sessionId,
      clientName: record.clientName,
      tokenHash,
      exp,
    }),
    {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/upload",
      maxAge: COOKIE_MAX_AGE_SECONDS,
    }
  );
  return response;
}
