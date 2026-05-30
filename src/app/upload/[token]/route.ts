import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { resolveUploadToken } from "@/lib/upload-tokens";
import { getLimiter } from "@/lib/rate-limit";
import {
  signCookie,
  COOKIE_NAME,
  COOKIE_MAX_AGE_SECONDS,
} from "@/lib/upload-session";
import { BRANDING } from "@/lib/branding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /upload/{token}
 *
 * Two-step magic-link redemption.
 *
 *   GET  → render a minimal confirmation page with a POST form. Does
 *          NOT consume the token. This is the link the recipient clicks
 *          from email. Mail-client link warmers (Outlook Safe Links,
 *          Mimecast, etc.) only ever issue GETs, so they walk away with
 *          the confirmation HTML and the token survives intact.
 *   POST → mint the signed session cookie, redirect to /upload/session.
 *          The token remains valid until its Redis TTL expires so clients
 *          can return from the same email link to upload more documents
 *          during the 7-day upload window. Manual revocation still deletes
 *          the Redis token if a link is reported leaked.
 *
 * Implemented as a Route Handler (not a Server Component page) because
 * Next.js 15 disallows cookie mutation in Server Components — only
 * Route Handlers and Server Actions can call `cookies().set()`.
 *
 * Failure modes (all degrade to 404 — never reveal whether the token
 * existed, was rate-limited, or had a missing IP):
 *   - No `x-forwarded-for` header
 *   - Rate limit hit
 *   - Token absent / expired in Redis
 *   - Token already consumed by a prior POST
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (!ip) return notFound();

  const { success } = await getLimiter.limit(ip);
  if (!success) return notFound();

  const { token } = await params;
  const resolved = await resolveUploadToken(token);
  if (!resolved) return notFound();

  return new NextResponse(renderConfirmPage(), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Belt to the existing Referrer-Policy header in next.config.ts.
      "referrer-policy": "no-referrer",
      // Don't let the page be cached or stored — the URL is a bearer.
      "cache-control": "no-store",
    },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (!ip) return notFound();

  const { success } = await getLimiter.limit(ip);
  if (!success) return notFound();

  const { token } = await params;
  const resolved = await resolveUploadToken(token);
  if (!resolved) return notFound();

  const { record, tokenHash } = resolved;
  const exp = Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE_SECONDS;

  const sessionUrl = new URL("/upload/session", req.url);
  const response = NextResponse.redirect(sessionUrl, { status: 303 });
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

function notFound(): NextResponse {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

function renderConfirmPage(): string {
  const firm = escapeHtmlAttr(BRANDING.firmName);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>${firm} — Continue to upload</title>
<style>
  :root { color-scheme: light; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      "Open Sans", sans-serif;
    background: #f7fafb;
    color: #1a1a1a;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    background: #fff;
    border: 1px solid #e5e5e5;
    border-radius: 12px;
    padding: 32px;
    max-width: 460px;
    width: 100%;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  }
  h1 { font-size: 18px; margin: 0 0 12px; }
  p { font-size: 14px; line-height: 1.5; color: #444; margin: 0 0 16px; }
  button {
    display: block;
    width: 100%;
    background: #61BBCA;
    color: #fff;
    border: 0;
    border-radius: 8px;
    padding: 12px 20px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
  }
  button:hover { background: #4ea7b6; }
  .note { font-size: 12px; color: #777; margin-top: 16px; }
</style>
</head>
<body>
  <main class="card">
    <h1>Continue to upload your documents</h1>
    <p>You'll be taken to a private page where you can upload files for your matter with ${firm}.</p>
    <form method="POST" action="">
      <button type="submit">Continue</button>
    </form>
    <p class="note">This secure link stays valid for 7 days, so you can return to this email if you need to upload more files later.</p>
  </main>
</body>
</html>`;
}

// Minimal HTML attribute escaper for the firm name. We don't pull in the
// shared escapeHtml helper here to keep this route's deps tiny.
function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
