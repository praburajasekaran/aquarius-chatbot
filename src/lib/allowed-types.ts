export const ALLOWED_CONTENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/heic",
  "image/heic-sequence",
  "image/heif",
  "image/heif-sequence",
  "image/png",
  "application/msword",
  "application/rtf",
  "text/rtf",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

export const MAX_BYTES = 20 * 1024 * 1024;

export function formatUploadLimit(bytes: number = MAX_BYTES): string {
  return `${bytes / (1024 * 1024)} MB`;
}

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".png": "image/png",
  ".doc": "application/msword",
  ".rtf": "application/rtf",
  ".txt": "text/plain",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function normalizeContentType(mimeType: string): string {
  if (mimeType.toLowerCase().startsWith("text/plain;")) return "text/plain";
  return mimeType === "image/jpg" ? "image/jpeg" : mimeType;
}

export function isAllowedContentType(mimeType: string): boolean {
  return (ALLOWED_CONTENT_TYPES as readonly string[]).includes(
    normalizeContentType(mimeType)
  );
}

export function contentTypeFromFilename(filename: string): string | null {
  const lower = filename.toLowerCase();
  for (const [extension, contentType] of Object.entries(EXTENSION_CONTENT_TYPES)) {
    if (lower.endsWith(extension)) return contentType;
  }
  return null;
}

export function resolveUploadContentType(
  mimeType: string,
  filename: string
): string | null {
  if (isAllowedContentType(mimeType)) return normalizeContentType(mimeType);
  return contentTypeFromFilename(filename);
}
