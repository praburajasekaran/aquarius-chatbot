import { NextResponse } from "next/server";
import { head } from "@vercel/blob";
import { verifySessionSecret } from "@/lib/kv";

export const runtime = "nodejs";

/**
 * Authenticated document proxy.
 *
 * Vercel Blob files are stored with public access so that Zapier (which
 * can't authenticate through our app) can still receive raw URLs. This
 * route provides an authenticated access path for the browser: it
 * verifies the caller owns the session before streaming the file,
 * ensuring document URLs aren't usable by anyone who stumbles across
 * them.
 *
 * Path: /api/documents/uploads/{sessionId}/{timestamp}-{filename}
 * Auth: sessionSecret via ?secret= query parameter
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const pathname = path.join("/");

  // Extract sessionId from the blob path. Blobs are stored as
  // uploads/{sessionId}/{timestamp}-{filename}.
  if (!pathname.startsWith("uploads/")) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const parts = pathname.split("/");
  if (parts.length < 3) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const sessionId = parts[1];

  const url = new URL(req.url);
  const sessionSecret = url.searchParams.get("secret");
  if (!sessionSecret) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const ok = await verifySessionSecret(sessionId, sessionSecret);
  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const blob = await head(pathname);
    if (!blob) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const response = await fetch(blob.url);
    if (!response.ok) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    return new Response(response.body, {
      status: 200,
      headers: {
        "Content-Type": blob.contentType,
        "Content-Disposition": `inline; filename="${encodeURIComponent(blob.pathname.split("/").pop() ?? "file")}"`,
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    console.error("[documents] proxy fetch failed", {
      event: "doc_proxy_fetch_failed",
      pathname,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
