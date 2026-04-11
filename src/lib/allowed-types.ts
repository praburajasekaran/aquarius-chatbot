export const ALLOWED_CONTENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

export const MAX_BYTES = 10 * 1024 * 1024;
