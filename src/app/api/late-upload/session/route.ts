import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import path from "node:path";
import { put } from "@vercel/blob";
import { verifyCookie, COOKIE_NAME } from "@/lib/upload-session";
import {
  tokenLimiter,
  globalLimiter,
  ipUploadLimiter,
} from "@/lib/rate-limit";
import { hashToken } from "@/lib/upload-tokens";
import {
  ALLOWED_CONTENT_TYPES,
  MAX_BYTES,
  resolveUploadContentType,
} from "@/lib/allowed-types";
import { checkMagicBytes } from "@/lib/upload/magic-byte-check";
import { handleUploadCompleted } from "@/lib/late-upload/handle-completed";

export const runtime = "nodejs";
export const maxDuration = 15;

const ALLOWED_TYPES_LABEL = "PDF, JPG, HEIC/HEIF, PNG, DOC, DOCX, RTF, TXT";

function safeFilename(name: string): string {
  const base = path.basename(name.replace(/\\/g, "/"));
  let cleaned = "";
  for (const c of base) {
    const code = c.charCodeAt(0);
    if (code >= 32 && code !== 127) cleaned += c;
  }
  const trimmed = cleaned.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") return "file";
  return trimmed.slice(0, 200);
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const session = verifyCookie(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Prefer the magic-link token hash (unguessable, per-token) as the
  // bucket key. Fall back to hashing the sessionId for back-compat with
  // cookies issued before tokenHash was stamped into the payload — those
  // existing cookies live for up to 7 days post-deploy.
  const tokenKey = session.tokenHash ?? hashToken(session.sessionId);
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  const [tk, ipR, gl] = await Promise.all([
    tokenLimiter.limit(tokenKey),
    ipUploadLimiter.limit(ip),
    globalLimiter.limit("global"),
  ]);
  // Fire-and-forget analytics writes; don't block the response on them
  void Promise.all([tk.pending, ipR.pending, gl.pending]);

  if (!tk.success || !ipR.success || !gl.success) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const cleanName = safeFilename(file.name);
  const contentType = resolveUploadContentType(file.type, cleanName);
  if (
    !contentType ||
    !(ALLOWED_CONTENT_TYPES as readonly string[]).includes(contentType)
  ) {
    return NextResponse.json(
      { error: `Unsupported file type. Allowed: ${ALLOWED_TYPES_LABEL}.` },
      { status: 415 }
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "File exceeds the upload size limit." },
      { status: 413 }
    );
  }

  const magic = await checkMagicBytes({
    kind: "blob",
    blob: file,
    declared: contentType,
  });
  if (!magic.ok) {
    return NextResponse.json(
      {
        error: `File contents don't match its type. Allowed: ${ALLOWED_TYPES_LABEL}.`,
      },
      { status: 415 }
    );
  }

  try {
    const blob = await put(
      `late-uploads/${session.sessionId}/${Date.now()}-${crypto.randomUUID()}-${cleanName}`,
      file,
      { access: "private", contentType }
    );
    await handleUploadCompleted({
      blob,
      matterRef: session.matterRef,
      sessionId: session.sessionId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[late-upload] upload error", err);
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }
}
