import { fileTypeFromBuffer } from "file-type";
import {
  ALLOWED_CONTENT_TYPES,
  type AllowedContentType,
} from "@/lib/allowed-types";

const HEAD_BYTES = 4096;

export interface MagicByteResult {
  ok: boolean;
  detected: string | null;
  declared: string;
  reason?: string;
}

function isAllowed(mime: string): boolean {
  return (ALLOWED_CONTENT_TYPES as readonly string[]).includes(
    mime as AllowedContentType,
  );
}

/**
 * Verify that a file's actual magic bytes match its declared MIME type AND
 * that both are in the allowlist. Defends against attackers uploading e.g.
 * an HTML file with `Content-Type: image/png` — the declared type alone is
 * trivial to spoof.
 *
 * `file` may be a File/Blob (we'll read the head ourselves) or a Buffer of
 * the head bytes. Returns `{ ok: false }` on any mismatch / unsupported
 * detection so the caller can reject.
 */
export async function checkMagicBytes(
  source: { kind: "blob"; blob: Blob; declared: string }
    | { kind: "buffer"; buf: Buffer; declared: string },
): Promise<MagicByteResult> {
  const declared = source.declared;
  const declaredOk = isAllowed(declared);
  if (!declaredOk) {
    return { ok: false, detected: null, declared, reason: "declared_disallowed" };
  }

  let buf: Buffer;
  try {
    if (source.kind === "blob") {
      const head = source.blob.slice(0, HEAD_BYTES);
      buf = Buffer.from(await head.arrayBuffer());
    } else {
      buf = source.buf;
    }
  } catch {
    return { ok: false, detected: null, declared, reason: "read_failed" };
  }

  const detected = await fileTypeFromBuffer(buf);
  if (!detected) {
    return { ok: false, detected: null, declared, reason: "no_detection" };
  }
  if (!isAllowed(detected.mime)) {
    return {
      ok: false,
      detected: detected.mime,
      declared,
      reason: "detected_disallowed",
    };
  }
  if (detected.mime !== declared) {
    return {
      ok: false,
      detected: detected.mime,
      declared,
      reason: "mismatch",
    };
  }

  return { ok: true, detected: detected.mime, declared };
}
