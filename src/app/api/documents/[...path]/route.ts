import { NextResponse } from "next/server";
import { get, head } from "@vercel/blob";
import { verifySessionSecret } from "@/lib/kv";
import { resolveDocumentAccessToken } from "@/lib/document-access";

export const runtime = "nodejs";

/**
 * Authenticated document proxy.
 *
 * Vercel Blob files are stored with private access. This route is the
 * only document download surface: browser callers can use the legacy
 * sessionSecret, while Zapier/firm notification links use a short-lived
 * bearer token scoped to the exact blob pathname.
 *
 * Paths:
 *   /api/documents/uploads/{sessionId}/{timestamp}-{filename}
 *   /api/documents/{late-upload-blob-pathname}
 * Auth: document token via ?token=, or legacy sessionSecret via ?secret=
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const pathname = path.join("/");

  const url = new URL(req.url);
  const accessToken = url.searchParams.get("token");
  if (accessToken) {
    const record = await resolveDocumentAccessToken(accessToken);
    if (!record || record.pathname !== pathname) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return streamPrivateBlob(pathname);
  }

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

  const sessionSecret = url.searchParams.get("secret");
  if (!sessionSecret) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const ok = await verifySessionSecret(sessionId, sessionSecret);
  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return streamPrivateBlob(pathname);
}

async function streamPrivateBlob(pathname: string): Promise<Response> {
  try {
    const [blob, privateBlob] = await Promise.all([
      head(pathname),
      get(pathname, { access: "private" }),
    ]);
    if (!blob || !privateBlob?.stream) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    return new Response(privateBlob.stream, {
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
