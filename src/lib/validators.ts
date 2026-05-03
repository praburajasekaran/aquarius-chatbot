const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Reject control characters (incl. CR/LF) anywhere in the address — prevents
// header injection when the value is interpolated into email contexts before
// reaching Resend.
const EMAIL_CONTROL_CHAR_REGEX = /[\x00-\x1F\x7F]/;

// Australian phone: mobile (04XX), landline (02/03/07/08), or +61
const AU_PHONE_REGEX =
  /^(?:\+?61|0)(?:4\d{8}|[2378]\d{8})$|^(?:04\d{2}\s?\d{3}\s?\d{3})$|^(?:0[2378]\s?\d{4}\s?\d{4})$/;

export function validateEmail(email: string): boolean {
  const trimmed = email.trim();
  if (EMAIL_CONTROL_CHAR_REGEX.test(trimmed)) return false;
  return EMAIL_REGEX.test(trimmed);
}

export function validatePhone(phone: string): boolean {
  const cleaned = phone.replace(/[\s\-()]/g, "");
  return AU_PHONE_REGEX.test(cleaned);
}

export function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-()]/g, "");
}

const ALLOWED_FILE_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export function validateFileType(mimeType: string): boolean {
  return ALLOWED_FILE_TYPES.includes(mimeType);
}

export function validateFileSize(sizeBytes: number): boolean {
  return sizeBytes <= MAX_FILE_SIZE;
}
