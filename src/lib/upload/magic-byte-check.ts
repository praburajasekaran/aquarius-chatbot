import { fileTypeFromBuffer } from "file-type";
import {
  isAllowedContentType,
  normalizeContentType,
} from "@/lib/allowed-types";

const HEAD_BYTES = 4096;
const HEIF_FAMILY = new Set([
  "image/heic",
  "image/heic-sequence",
  "image/heif",
  "image/heif-sequence",
]);
const RTF_TYPES = new Set(["application/rtf", "text/rtf"]);
const TEXT_TYPES = new Set(["text/plain"]);

export interface MagicByteResult {
  ok: boolean;
  detected: string | null;
  declared: string;
  reason?: string;
}

function contentTypesMatch(detected: string, declared: string): boolean {
  const normalizedDetected = normalizeContentType(detected);
  const normalizedDeclared = normalizeContentType(declared);
  if (normalizedDetected === normalizedDeclared) return true;
  if (HEIF_FAMILY.has(normalizedDetected) && HEIF_FAMILY.has(normalizedDeclared)) {
    return true;
  }
  if (RTF_TYPES.has(normalizedDetected) && RTF_TYPES.has(normalizedDeclared)) {
    return true;
  }
  return normalizedDetected === "application/x-cfb" && normalizedDeclared === "application/msword";
}

function looksLikePlainText(buf: Buffer): boolean {
  if (buf.length === 0) return true;
  for (const byte of buf) {
    if (byte === 0) return false;
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) return false;
  }
  return true;
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
  const normalizedDeclared = normalizeContentType(declared);
  const declaredOk = isAllowedContentType(declared);
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
    if (TEXT_TYPES.has(normalizedDeclared) && looksLikePlainText(buf)) {
      return { ok: true, detected: "text/plain", declared };
    }
    return { ok: false, detected: null, declared, reason: "no_detection" };
  }
  if (!isAllowedContentType(detected.mime) && !contentTypesMatch(detected.mime, declared)) {
    return {
      ok: false,
      detected: detected.mime,
      declared,
      reason: "detected_disallowed",
    };
  }
  if (!contentTypesMatch(detected.mime, normalizedDeclared)) {
    return {
      ok: false,
      detected: detected.mime,
      declared,
      reason: "mismatch",
    };
  }

  return { ok: true, detected: detected.mime, declared };
}
