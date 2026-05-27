import { del, head } from "@vercel/blob";
import type { PutBlobResult } from "@vercel/blob";
import { fileTypeFromBuffer } from "file-type";
import { sendAndLog } from "@/lib/resend";
import { sendToZapier } from "@/lib/zapier";
import { redis } from "@/lib/kv";
import {
  ALLOWED_CONTENT_TYPES,
  type AllowedContentType,
} from "@/lib/allowed-types";
import { getRecordByHash } from "@/lib/upload-tokens";
import { touchMatterForSession } from "@/lib/session-matter-map";
import { cancelPendingReminder } from "@/lib/sms/reminder";
import type { UploadTokenRecord } from "@/types";
import { BRANDING } from "@/lib/branding";
import FirmUploadNotificationEmail from "@/lib/email/templates/firm-upload-notification";
import ClientUploadConfirmationEmail, {
  clientUploadConfirmationText,
} from "@/lib/email/templates/client-upload-confirmation";

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

  // Resolve the Smokeball matter ID captured by Zap #1's tail webhook.
  // Missing mapping is not fatal — we still fire the Zap with matter_ref only
  // so Zapier / the firm can reconcile manually, and we flag it in the firm
  // notification email. Renews the 90d TTL if present.
  const matterMapping = await touchMatterForSession(sessionId);
  const smokeballMatterId = matterMapping?.smokeballMatterId ?? null;
  if (!smokeballMatterId) {
    console.warn("[late-upload] no Smokeball matter mapping for session", {
      sessionId,
      matterRef,
    });
  }

  // --- Smokeball attach Zap ---
  let attachZapStatus: "ok" | "failed" = "ok";
  try {
    const attachUrl = process.env.ZAPIER_ATTACH_WEBHOOK_URL;
    if (!attachUrl) throw new Error("ZAPIER_ATTACH_WEBHOOK_URL not configured");
    await sendToZapier(attachUrl, {
      matter_ref: matterRef,
      smokeball_matter_id: smokeballMatterId,
      session_id: sessionId,
      client_email: record.clientEmail,
      client_name: record.clientName,
      file: {
        url: blob.url,
        name: fileName,
        content_type: blob.contentType,
        size_bytes: sizeBytes,
      },
      uploaded_at: uploadedAt,
      source: "website chatbot",
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
      smokeball_matter_id: smokeballMatterId,
      session_id: sessionId,
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

  // --- firm notification ---
  if (from && firmTo) {
    try {
      const needsManual =
        attachZapStatus === "failed" || !smokeballMatterId;
      const displayName = record.clientName || "Client";
      await sendAndLog(
        {
          from,
          to: firmTo,
          subject: `Upload received — ${displayName} (${fileName})`,
          react: FirmUploadNotificationEmail({
            clientName: record.clientName ?? "",
            clientEmail: record.clientEmail,
            matterRef,
            smokeballMatterId,
            fileName,
            contentType: blob.contentType,
            sizeBytes,
            url: blob.url,
            attachZapStatus,
            uploadedAt,
            needsManual,
          }),
        },
        { event: "late_upload_firm_notify", sessionId }
      );
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
      const clientName = record.clientName ?? "";
      await sendAndLog(
        {
          from,
          to: record.clientEmail,
          subject: `Upload received — ${BRANDING.firmName}`,
          react: ClientUploadConfirmationEmail({ clientName, fileName }),
          text: clientUploadConfirmationText({ clientName, fileName }),
        },
        { event: "late_upload_client_notify", sessionId }
      );
    } catch (err) {
      console.error("[late-upload] client notify failed", err);
    }
  }

  // --- suppress the pending 24h reminder SMS (PHASE-03) ---
  // Two layers of protection, in order:
  //   1. Set `uploaded:{sessionId}` flag (26h TTL — outlives the 24h delay).
  //      The reminder webhook reads this flag and short-circuits ("skipped —
  //      already uploaded") even if the QStash message is still queued. This
  //      is the durable guarantee — survives QStash cancel failures, network
  //      blips, and races where the reminder fires concurrently with upload.
  //   2. Cancel the QStash message so it never even attempts delivery
  //      (saves a wasted callback + log line).
  // Both wrapped in try/catch so the upload-completed handler never throws
  // past this point — the upload itself has already succeeded.
  const UPLOADED_FLAG_TTL_SECONDS = 26 * 3600; // 26h, matches reminder key TTL
  try {
    await redis.set(`uploaded:${sessionId}`, "1", {
      ex: UPLOADED_FLAG_TTL_SECONDS,
    });
  } catch (err) {
    console.error("[late-upload] uploaded-flag set threw", {
      event: "late_upload_flag_set_failed",
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
  try {
    await cancelPendingReminder(sessionId);
  } catch (err) {
    console.error("[late-upload] cancel reminder threw", {
      event: "late_upload_cancel_reminder_failed",
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

async function lookupRecordBySessionId(
  sessionId: string
): Promise<UploadTokenRecord | null> {
  const tokenHash = await redis.get<string>(`payment-session:${sessionId}`);
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
