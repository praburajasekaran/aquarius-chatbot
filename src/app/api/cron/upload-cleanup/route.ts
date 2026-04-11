import { list, del } from "@vercel/blob";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "server_misconfigured" },
      { status: 500 }
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cutoff = Date.now() - RETENTION_MS;
  let cursor: string | undefined;
  let deleted = 0;

  do {
    const page = await list({ cursor, limit: 1000 });
    const stale = page.blobs.filter(
      (b) => new Date(b.uploadedAt).getTime() < cutoff
    );
    if (stale.length) {
      await del(stale.map((b) => b.url));
      deleted += stale.length;
    }
    cursor = page.cursor;
  } while (cursor);

  return NextResponse.json({ deleted });
}
