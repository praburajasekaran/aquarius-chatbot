import { sendToZapier } from "@/lib/zapier";
import { getIntake } from "@/lib/intake";
import { getMatterForSession } from "@/lib/session-matter-map";

export interface InChatUploadFile {
  url: string;
  name: string;
  contentType: string;
  sizeBytes: number;
}

/**
 * Fan-out for in-chat document uploads.
 *
 * Mirrors the late-upload Zapier payload so the same Smokeball-attach Zap
 * (Zap #2) can route both flows. Best-effort — never throws past the
 * upload response. The Smokeball matter mapping is usually absent at this
 * point (Zap #1 is racing the in-chat upload), so `smokeball_matter_id`
 * will most often be null. Zapier-side handling for null IDs (queue or
 * MANUAL REQUIRED) is the same logic used by late uploads.
 */
export async function deliverInChatUploadsToZapier(args: {
  sessionId: string;
  files: InChatUploadFile[];
}): Promise<void> {
  const { sessionId, files } = args;
  if (files.length === 0) return;

  const attachUrl = process.env.ZAPIER_ATTACH_WEBHOOK_URL;
  const auditUrl = process.env.ZAPIER_AUDIT_WEBHOOK_URL;

  if (!attachUrl && !auditUrl) {
    console.warn("[in-chat-upload] Zapier URLs not configured — delivery skipped", {
      event: "in_chat_zapier_skipped",
      reason: "no_webhooks",
      sessionId,
    });
    return;
  }

  const intake = await getIntake(sessionId).catch((err) => {
    console.error("[in-chat-upload] intake lookup threw", {
      event: "in_chat_intake_lookup_failed",
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  });

  const mapping = await getMatterForSession(sessionId).catch((err) => {
    console.error("[in-chat-upload] matter mapping lookup threw", {
      event: "in_chat_matter_lookup_failed",
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  });

  const smokeballMatterId = mapping?.smokeballMatterId ?? null;
  const clientEmail = intake?.clientEmail ?? "";
  const clientName = intake?.clientName ?? "";
  const uploadedAt = new Date().toISOString();

  if (!smokeballMatterId) {
    console.info("[in-chat-upload] no Smokeball matter mapping yet", {
      event: "in_chat_no_matter_mapping",
      sessionId,
    });
  }

  await Promise.allSettled(
    files.map(async (file) => {
      let attachZapStatus: "ok" | "failed" | "skipped" = "skipped";

      if (attachUrl) {
        try {
          await sendToZapier(attachUrl, {
            matter_ref: sessionId,
            smokeball_matter_id: smokeballMatterId,
            session_id: sessionId,
            client_email: clientEmail,
            client_name: clientName,
            file: {
              url: file.url,
              name: file.name,
              content_type: file.contentType,
              size_bytes: file.sizeBytes,
            },
            uploaded_at: uploadedAt,
            source: "chatbot/in-chat-upload",
          });
          attachZapStatus = "ok";
        } catch (err) {
          attachZapStatus = "failed";
          console.error("[in-chat-upload] attach zap failed", {
            event: "in_chat_attach_zap_failed",
            sessionId,
            file: file.name,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (auditUrl) {
        try {
          await sendToZapier(auditUrl, {
            event: "in_chat_upload.completed",
            matter_ref: sessionId,
            smokeball_matter_id: smokeballMatterId,
            session_id: sessionId,
            client_email: clientEmail,
            client_name: clientName,
            file_name: file.name,
            file_size_bytes: file.sizeBytes,
            attach_zap_status: attachZapStatus,
            uploaded_at: uploadedAt,
          });
        } catch (err) {
          console.error("[in-chat-upload] audit zap failed", {
            event: "in_chat_audit_zap_failed",
            sessionId,
            file: file.name,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })
  );

  console.info("[in-chat-upload] zapier delivery complete", {
    event: "in_chat_zapier_delivered",
    sessionId,
    file_count: files.length,
    smokeball_matter_id: smokeballMatterId,
  });
}
