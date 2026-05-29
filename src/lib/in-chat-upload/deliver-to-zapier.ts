import FirmInChatUploadNotificationEmail, {
  type FirmInChatUploadNotificationFile,
  type InChatUploadFirmStatus,
} from "@/lib/email/templates/firm-in-chat-upload-notification";
import { sendToZapier } from "@/lib/zapier";
import { getIntake } from "@/lib/intake";
import { getMatterForSession } from "@/lib/session-matter-map";
import { sendAndLog } from "@/lib/resend";

export interface InChatUploadFile {
  url: string;
  name: string;
  contentType: string;
  sizeBytes: number;
}

export interface InChatUploadWaitOptions {
  attempts?: number;
  delayMs?: number;
}

type AttachZapStatus = "ok" | "failed" | "skipped";

const DEFAULT_MAPPING_ATTEMPTS = 5;
const DEFAULT_MAPPING_DELAY_MS = 2000;

/**
 * Fan-out for in-chat document uploads.
 *
 * Mirrors the late-upload Zapier payload so the same Smokeball-attach Zap
 * (Zap #2) can route both flows. Best-effort - never throws past the
 * upload response. Firm notification always includes Blob links so the firm
 * can manually attach files if the Smokeball mapping or attach Zap fails.
 */
export async function deliverInChatUploadsToZapier(args: {
  sessionId: string;
  files: InChatUploadFile[];
  waitOptions?: InChatUploadWaitOptions;
}): Promise<void> {
  const { sessionId, files, waitOptions } = args;
  if (files.length === 0) return;

  const attachUrl = process.env.ZAPIER_ATTACH_WEBHOOK_URL;
  const auditUrl = process.env.ZAPIER_AUDIT_WEBHOOK_URL;

  if (!attachUrl && !auditUrl) {
    console.warn("[in-chat-upload] Zapier URLs not configured - Zap delivery skipped", {
      event: "in_chat_zapier_skipped",
      reason: "no_webhooks",
      sessionId,
    });
  }

  const intake = await getIntake(sessionId).catch((err) => {
    console.error("[in-chat-upload] intake lookup threw", {
      event: "in_chat_intake_lookup_failed",
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  });

  const smokeballMatterId = await waitForInChatMatterMapping(
    sessionId,
    waitOptions
  );
  const clientEmail = intake?.clientEmail ?? "";
  const clientName = intake?.clientName ?? "";
  const uploadedAt = new Date().toISOString();

  if (!smokeballMatterId) {
    console.info("[in-chat-upload] no Smokeball matter mapping yet", {
      event: "in_chat_no_matter_mapping",
      sessionId,
    });
  }

  const results = await Promise.all(
    files.map((file) =>
      deliverOneFile({
        file,
        attachUrl,
        auditUrl,
        sessionId,
        smokeballMatterId,
        clientEmail,
        clientName,
        uploadedAt,
      })
    )
  );

  await notifyFirm({
    sessionId,
    clientName,
    clientEmail,
    smokeballMatterId,
    uploadedAt,
    files: results,
  });

  console.info("[in-chat-upload] zapier delivery complete", {
    event: "in_chat_zapier_delivered",
    sessionId,
    file_count: files.length,
    smokeball_matter_id: smokeballMatterId,
  });
}

export async function waitForInChatMatterMapping(
  sessionId: string,
  options: InChatUploadWaitOptions = {}
): Promise<string | null> {
  const attempts = options.attempts ?? DEFAULT_MAPPING_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_MAPPING_DELAY_MS;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const mapping = await getMatterForSession(sessionId).catch((err) => {
      console.error("[in-chat-upload] matter mapping lookup threw", {
        event: "in_chat_matter_lookup_failed",
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    });
    if (mapping?.smokeballMatterId) return mapping.smokeballMatterId;
    if (attempt < attempts - 1) await sleep(delayMs);
  }

  return null;
}

async function deliverOneFile(args: {
  file: InChatUploadFile;
  attachUrl: string | undefined;
  auditUrl: string | undefined;
  sessionId: string;
  smokeballMatterId: string | null;
  clientEmail: string;
  clientName: string;
  uploadedAt: string;
}): Promise<FirmInChatUploadNotificationFile> {
  const {
    file,
    attachUrl,
    auditUrl,
    sessionId,
    smokeballMatterId,
    clientEmail,
    clientName,
    uploadedAt,
  } = args;
  let attachZapStatus: AttachZapStatus = "skipped";
  let firmStatus: InChatUploadFirmStatus = "Manual attach required";
  let detail = "No Smokeball matter mapping was captured before the retry window ended.";

  if (attachUrl && smokeballMatterId) {
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
        file_url: file.url,
        file_name: file.name,
        file_content_type: file.contentType,
        file_size_bytes: file.sizeBytes,
        uploaded_at: uploadedAt,
        source: "website chatbot",
      });
      attachZapStatus = "ok";
      firmStatus = "Sent to Smokeball";
      detail = "Zapier accepted the Smokeball attach webhook.";
    } catch (err) {
      attachZapStatus = "failed";
      detail = err instanceof Error ? err.message : String(err);
      console.error("[in-chat-upload] attach zap failed", {
        event: "in_chat_attach_zap_failed",
        sessionId,
        file: file.name,
        err: detail,
      });
    }
  } else if (!attachUrl) {
    detail = "ZAPIER_ATTACH_WEBHOOK_URL is not configured.";
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
        file_url: file.url,
        file_name: file.name,
        file_content_type: file.contentType,
        file_size_bytes: file.sizeBytes,
        attach_zap_status: attachZapStatus,
        firm_status: firmStatus,
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

  return {
    name: file.name,
    contentType: file.contentType,
    sizeBytes: file.sizeBytes,
    url: file.url,
    status: firmStatus,
    detail,
  };
}

async function notifyFirm(args: {
  sessionId: string;
  clientName: string;
  clientEmail: string;
  smokeballMatterId: string | null;
  uploadedAt: string;
  files: FirmInChatUploadNotificationFile[];
}) {
  const from = process.env.RESEND_FROM_EMAIL;
  const firmTo = process.env.FIRM_NOTIFY_EMAIL;

  if (!from || !firmTo) {
    console.warn(
      "[in-chat-upload] RESEND_FROM_EMAIL or FIRM_NOTIFY_EMAIL not set - skipping firm notify"
    );
    return;
  }

  try {
    const displayName = args.clientName || "Client";
    await sendAndLog(
      {
        from,
        to: firmTo,
        subject: `Upload received - ${displayName} (${args.files.length} files)`,
        react: FirmInChatUploadNotificationEmail({
          clientName: args.clientName,
          clientEmail: args.clientEmail,
          matterRef: args.sessionId,
          smokeballMatterId: args.smokeballMatterId,
          uploadedAt: args.uploadedAt,
          files: args.files,
        }),
      },
      { event: "in_chat_upload_firm_notify", sessionId: args.sessionId }
    );
  } catch (err) {
    console.error("[in-chat-upload] firm notify failed", {
      event: "in_chat_firm_notify_failed",
      sessionId: args.sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
