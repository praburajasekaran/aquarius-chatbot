import path from "node:path";
import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { validateFileSize } from "@/lib/validators";
import { createSession, getSession, updateSession } from "@/lib/kv";
import { deliverInChatUploadsToZapier } from "@/lib/in-chat-upload/deliver-to-zapier";
import { inChatUploadLimiter } from "@/lib/rate-limit";
import { checkMagicBytes } from "@/lib/upload/magic-byte-check";
import { resolveUploadContentType } from "@/lib/allowed-types";

const MAX_FILES_PER_SESSION = 5;
const MAX_SESSION_ID_LENGTH = 200;
const ALLOWED_TYPES_LABEL = "PDF, JPG, HEIC/HEIF, PNG, DOC, DOCX, RTF, TXT";

function safeFilename(name: string): string {
  // Strip any directory components — uploads must land flat under
  // uploads/{sessionId}/, never traverse out of it. basename handles ../ and
  // backslashes; we then drop control chars and clamp length.
  const base = path.basename(name);
  let cleaned = "";
  for (const c of base) {
    const code = c.charCodeAt(0);
    if (code >= 32 && code !== 127) cleaned += c;
  }
  const trimmed = cleaned.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") return "file";
  return trimmed.slice(0, 200);
}

export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { success } = await inChatUploadLimiter.limit(ip);
  if (!success) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  try {
    const formData = await req.formData();
    const sessionIdRaw = formData.get("sessionId");
    const files = formData.getAll("files");

    if (
      typeof sessionIdRaw !== "string" ||
      sessionIdRaw.length === 0 ||
      sessionIdRaw.length > MAX_SESSION_ID_LENGTH
    ) {
      return NextResponse.json(
        { error: "Session ID required" },
        { status: 400 }
      );
    }
    const sessionId = sessionIdRaw;

    const fileEntries = files.filter((f): f is File => f instanceof File);
    if (fileEntries.length === 0) {
      return NextResponse.json(
        { error: "No files provided" },
        { status: 400 }
      );
    }

    // Session is generated client-side; if it isn't in Redis yet (nothing has
    // persisted it up to this point in the flow), create it on demand so the
    // upload can proceed.
    const session =
      (await getSession(sessionId)) ?? (await createSession(sessionId));

    const remainingSlots = MAX_FILES_PER_SESSION - session.uploadRefs.length;
    if (remainingSlots <= 0) {
      return NextResponse.json(
        { error: `Maximum ${MAX_FILES_PER_SESSION} files allowed per session` },
        { status: 400 }
      );
    }

    const filesToProcess = fileEntries.slice(0, remainingSlots);
    const skipped = fileEntries.length - filesToProcess.length;

    const successful: {
      url: string;
      name: string;
      contentType: string;
      sizeBytes: number;
    }[] = [];
    const errors: { name: string; reason: string }[] = [];

    for (const file of filesToProcess) {
      const cleanName = safeFilename(file.name);
      const contentType = resolveUploadContentType(file.type, cleanName);

      if (!contentType) {
        errors.push({
          name: cleanName,
          reason: `Invalid file type. Allowed: ${ALLOWED_TYPES_LABEL}`,
        });
        continue;
      }

      if (!validateFileSize(file.size)) {
        errors.push({
          name: cleanName,
          reason: "File exceeds 10MB limit",
        });
        continue;
      }

      // Magic-byte check: declared Content-Type alone is client-controlled
      // and trivial to spoof. Reject any file whose actual bytes don't
      // match its declared MIME, or whose detected type isn't in the
      // allowlist. Mirrors the same check the late-upload completion
      // handler does.
      const magic = await checkMagicBytes({
        kind: "blob",
        blob: file,
        declared: contentType,
      });
      if (!magic.ok) {
        console.warn("[upload] magic-byte mismatch", {
          event: "in_chat_magic_byte_mismatch",
          sessionId,
          name: cleanName,
          declared: magic.declared,
          detected: magic.detected,
          reason: magic.reason,
        });
        errors.push({
          name: cleanName,
          reason: `File contents don't match its type. Allowed: ${ALLOWED_TYPES_LABEL}`,
        });
        continue;
      }

      try {
        const blob = await put(
          `uploads/${sessionId}/${Date.now()}-${cleanName}`,
          file,
          { access: "public", contentType }
        );
        successful.push({
          url: blob.url,
          name: cleanName,
          contentType,
          sizeBytes: file.size,
        });
      } catch (err) {
        // Don't echo vendor error messages to the client — they can leak
        // bucket names, internal hostnames, or signed-URL fragments. Log
        // server-side, return a generic reason.
        console.error("[upload] vercel blob put failed", {
          event: "blob_put_failed",
          sessionId,
          name: cleanName,
          err: err instanceof Error ? err.message : String(err),
        });
        errors.push({ name: cleanName, reason: "Upload failed" });
      }
    }

    const uploadedRefs = successful.map((s) => s.url);

    if (uploadedRefs.length > 0) {
      await updateSession(sessionId, {
        uploadRefs: [...session.uploadRefs, ...uploadedRefs],
      });

      try {
        await deliverInChatUploadsToZapier({
          sessionId,
          files: successful,
        });
      } catch (err) {
        // Belt-and-braces — deliver helper already swallows its own errors.
        console.error("[upload] zapier delivery threw past helper", {
          event: "in_chat_zapier_unhandled",
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (errors.length > 0 && uploadedRefs.length === 0) {
      return NextResponse.json({ errors }, { status: 422 });
    }

    return NextResponse.json({
      uploaded: uploadedRefs.length,
      totalUploaded: session.uploadRefs.length + uploadedRefs.length,
      ...(errors.length > 0 ? { errors } : {}),
      ...(skipped > 0
        ? {
            warning: `${skipped} file(s) skipped — session limit of ${MAX_FILES_PER_SESSION} reached`,
          }
        : {}),
    });
  } catch (error) {
    console.error("[upload] error:", error);
    return NextResponse.json(
      { error: "Upload failed. Please try again." },
      { status: 500 }
    );
  }
}
