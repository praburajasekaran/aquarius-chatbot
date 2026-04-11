import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { validateFileType, validateFileSize } from "@/lib/validators";
import { createSession, getSession, updateSession } from "@/lib/kv";

const MAX_FILES_PER_SESSION = 5;

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const sessionId = formData.get("sessionId") as string | null;
    const files = formData.getAll("files") as File[];

    if (!sessionId) {
      return NextResponse.json(
        { error: "Session ID required" },
        { status: 400 }
      );
    }

    if (files.length === 0) {
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

    const filesToProcess = files.slice(0, remainingSlots);
    const skipped = files.length - filesToProcess.length;

    const uploadedRefs: string[] = [];
    const errors: { name: string; reason: string }[] = [];

    for (const file of filesToProcess) {
      if (!validateFileType(file.type)) {
        errors.push({
          name: file.name,
          reason: "Invalid file type. Allowed: PDF, JPG, PNG, DOCX",
        });
        continue;
      }

      if (!validateFileSize(file.size)) {
        errors.push({
          name: file.name,
          reason: "File exceeds 10MB limit",
        });
        continue;
      }

      try {
        const blob = await put(
          `uploads/${sessionId}/${Date.now()}-${file.name}`,
          file,
          { access: "public", contentType: file.type }
        );
        uploadedRefs.push(blob.url);
      } catch (err) {
        console.error("[upload] vercel blob put failed:", err);
        const message = err instanceof Error ? err.message : "Unknown error";
        errors.push({
          name: file.name,
          reason: `Upload failed: ${message}`,
        });
      }
    }

    if (uploadedRefs.length > 0) {
      await updateSession(sessionId, {
        uploadRefs: [...session.uploadRefs, ...uploadedRefs],
      });
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
