import crypto from "node:crypto";
import type { UploadSessionCookie } from "@/types";

export const COOKIE_NAME = "au_upload" as const;
export const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function secret(): string {
  const s = process.env.UPLOAD_COOKIE_SECRET;
  if (!s) throw new Error("UPLOAD_COOKIE_SECRET is not set");
  return s;
}

export function signCookie(payload: UploadSessionCookie): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", secret())
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

export function verifyCookie(
  cookie: string | undefined
): UploadSessionCookie | null {
  if (!cookie) return null;
  const [body, sig] = cookie.split(".");
  if (!body || !sig) return null;

  const expected = crypto
    .createHmac("sha256", secret())
    .update(body)
    .digest("base64url");

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString()
    ) as UploadSessionCookie;
    if (
      typeof payload.exp !== "number" ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
