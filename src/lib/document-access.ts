import crypto from "node:crypto";
import { redis } from "@/lib/kv";

export const DOCUMENT_ACCESS_TTL_SECONDS = 60 * 60 * 24 * 7;

const PREFIX = "document-access:";
const MIN_TOKEN_LENGTH = 32;

export interface DocumentAccessRecord {
  pathname: string;
  sessionId: string;
  fileName: string;
  contentType: string;
  createdAt: string;
}

function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export async function createDocumentAccessToken(
  input: Omit<DocumentAccessRecord, "createdAt">
): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const record: DocumentAccessRecord = {
    ...input,
    createdAt: new Date().toISOString(),
  };
  await redis.set(`${PREFIX}${hashToken(rawToken)}`, record, {
    ex: DOCUMENT_ACCESS_TTL_SECONDS,
  });
  return rawToken;
}

export async function resolveDocumentAccessToken(
  rawToken: string
): Promise<DocumentAccessRecord | null> {
  if (!rawToken || rawToken.length < MIN_TOKEN_LENGTH) return null;
  return redis.get<DocumentAccessRecord>(`${PREFIX}${hashToken(rawToken)}`);
}

export function getAppBaseUrl(): string {
  const configured =
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  if (!configured) {
    throw new Error("APP_URL is not configured");
  }
  return configured.replace(/\/+$/, "");
}

export function buildDocumentAccessUrl(args: {
  baseUrl: string;
  pathname: string;
  token: string;
}): string {
  const encodedPath = args.pathname
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const url = new URL(`/api/documents/${encodedPath}`, args.baseUrl);
  url.searchParams.set("token", args.token);
  return url.toString();
}
