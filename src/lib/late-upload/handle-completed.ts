import { del, head } from "@vercel/blob";
import type { PutBlobResult } from "@vercel/blob";
import { fileTypeFromBuffer } from "file-type";
import { resend } from "@/lib/resend";
import { sendToZapier } from "@/lib/zapier";
import { redis } from "@/lib/kv";
import {
  ALLOWED_CONTENT_TYPES,
  type AllowedContentType,
} from "@/lib/allowed-types";
import { getRecordByHash } from "@/lib/upload-tokens";
import type { UploadTokenRecord } from "@/types";
import { BRANDING } from "@/lib/branding";

export interface HandleCompletedArgs {
  blob: PutBlobResult;
  matterRef: string;
  sessionId: string;
}

const HEAD_BYTES = 4096;

export async function handleUploadCompleted(
  args: HandleCompletedArgs
): Promise<void> {
  const { blob, matterRef, sessionId } = args;

  const record = await lookupRecordBySessionId(sessionId);
  if (!record) {
    console.error(
      "[late-upload] record missing on completion — deleting blob",
      { sessionId }
    );
    await safeDel(blob.url);
    return;
  }

  // --- magic-byte validation ---
  let magicOk = false;
  try {
    const res = await fetch(blob.url, {
      headers: { Range: `bytes=0-${HEAD_BYTES - 1}` },
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const detected = await fileTypeFromBuffer(buf);

    const declared = blob.contentType;
    const declaredOk = isAllowed(declared);
    const detectedOk = detected ? isAllowed(detected.mime) : false;
    const mimesAgree = detected ? detected.mime === declared : false;

    magicOk = declaredOk && detectedOk && mimesAgree;

    if (!magicOk) {
      console.error("[late-upload] magic-byte mismatch — deleting blob", {
        matterRef,
        declared,
        detected: detected?.mime ?? "unknown",
      });
      await safeDel(blob.url);
      return;
    }
  } catch (err) {
    console.error("[late-upload] magic-byte check failed — deleting blob", err);
    await safeDel(blob.url);
    return;
  }

  // --- real size ---
  let sizeBytes: number | null = null;
  try {
    const meta = await head(blob.url);
    sizeBytes = meta.size;
  } catch (err) {
    console.warn("[late-upload] head() failed; proceeding without size", err);
  }

  const uploadedAt = new Date().toISOString();
  const fileName = blob.pathname.split("/").pop() ?? "file";

  // --- Smokeball attach Zap ---
  let attachZapStatus: "ok" | "failed" = "ok";
  try {
    const attachUrl = process.env.ZAPIER_ATTACH_WEBHOOK_URL;
    if (!attachUrl) throw new Error("ZAPIER_ATTACH_WEBHOOK_URL not configured");
    await sendToZapier(attachUrl, {
      matter_ref: matterRef,
      client_email: record.clientEmail,
      client_name: record.clientName,
      file: {
        url: blob.url,
        name: fileName,
        content_type: blob.contentType,
        size_bytes: sizeBytes,
      },
      uploaded_at: uploadedAt,
      source: "chatbot/late-upload",
    });
  } catch (err) {
    attachZapStatus = "failed";
    console.error("[late-upload] attach zap failed", err);
  }

  // --- durable audit Zap ---
  try {
    const auditUrl = process.env.ZAPIER_AUDIT_WEBHOOK_URL;
    if (!auditUrl) throw new Error("ZAPIER_AUDIT_WEBHOOK_URL not configured");
    await sendToZapier(auditUrl, {
      event: "late_upload.completed",
      matter_ref: matterRef,
      client_email: record.clientEmail,
      client_name: record.clientName,
      file_name: fileName,
      file_size_bytes: sizeBytes,
      attach_zap_status: attachZapStatus,
      uploaded_at: uploadedAt,
    });
  } catch (err) {
    console.error("[late-upload] audit zap failed", err);
  }

  const from = process.env.RESEND_FROM_EMAIL;
  const firmTo = process.env.FIRM_NOTIFY_EMAIL;

  // --- firm notification (plaintext) ---
  if (from && firmTo) {
    try {
      await resend.emails.send({
        from,
        to: firmTo,
        subject: `[Upload${
          attachZapStatus === "failed" ? " — MANUAL REQUIRED" : ""
        }] ${record.clientName || "Client"} — ${fileName}`,
        text: [
          `Client: ${record.clientName || "(no name)"} <${record.clientEmail}>`,
          `Matter ref: ${matterRef}`,
          `File: ${fileName} (${blob.contentType})`,
          `Size: ${sizeBytes ?? "?"} bytes`,
          `URL: ${blob.url}`,
          `Smokeball Zap status: ${attachZapStatus}`,
          `Uploaded at: ${uploadedAt}`,
        ].join("\n"),
      });
    } catch (err) {
      console.error("[late-upload] firm notify failed", err);
    }
  } else {
    console.warn(
      "[late-upload] RESEND_FROM_EMAIL or FIRM_NOTIFY_EMAIL not set — skipping firm notify"
    );
  }

  // --- client confirmation (out-of-band tripwire) ---
  if (from) {
    try {
      await resend.emails.send({
        from,
        to: record.clientEmail,
        subject: "We received a file for your matter",
        text: [
          `Hi ${record.clientName || "there"},`,
          "",
          `We just received "${fileName}" for your matter with ${BRANDING.firmName}.`,
          "If this wasn't you, please reply to this email immediately so we can secure your upload link.",
          "",
          `— ${BRANDING.firmName}`,
        ].join("\n"),
      });
    } catch (err) {
      console.error("[late-upload] client notify failed", err);
    }
  }
}

async function lookupRecordBySessionId(
  sessionId: string
): Promise<UploadTokenRecord | null> {
  const tokenHash = await redis.get<string>(`stripe-session:${sessionId}`);
  if (!tokenHash || tokenHash === "pending") return null;
  return getRecordByHash(tokenHash);
}

async function safeDel(url: string): Promise<void> {
  try {
    await del(url);
  } catch (err) {
    console.error("[late-upload] del() failed", { url, err });
  }
}

function isAllowed(mime: string): boolean {
  return (ALLOWED_CONTENT_TYPES as readonly string[]).includes(mime as AllowedContentType);
}
