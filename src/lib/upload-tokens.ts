import crypto from "node:crypto";
import { redis } from "@/lib/kv";
import type { UploadTokenRecord } from "@/types";

const TTL_SECONDS = 60 * 60 * 24 * 7;
const PREFIX = "upload-token:";
const MIN_TOKEN_LENGTH = 32;

function generateRawToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function createUploadToken(
  input: Omit<UploadTokenRecord, "createdAt">
): Promise<{ rawToken: string; record: UploadTokenRecord }> {
  const rawToken = generateRawToken();
  const record: UploadTokenRecord = {
    ...input,
    createdAt: new Date().toISOString(),
  };
  await redis.set(`${PREFIX}${hashToken(rawToken)}`, record, {
    ex: TTL_SECONDS,
  });
  return { rawToken, record };
}

export async function resolveUploadToken(
  rawToken: string
): Promise<{ record: UploadTokenRecord; tokenHash: string } | null> {
  if (!rawToken || rawToken.length < MIN_TOKEN_LENGTH) return null;
  const tokenHash = hashToken(rawToken);
  const record = await redis.get<UploadTokenRecord>(`${PREFIX}${tokenHash}`);
  return record ? { record, tokenHash } : null;
}

export async function getRecordByHash(
  tokenHash: string
): Promise<UploadTokenRecord | null> {
  return redis.get<UploadTokenRecord>(`${PREFIX}${tokenHash}`);
}

export async function revokeUploadToken(rawToken: string): Promise<void> {
  await redis.del(`${PREFIX}${hashToken(rawToken)}`);
}

export async function revokeTokenByHash(tokenHash: string): Promise<void> {
  await redis.del(`${PREFIX}${tokenHash}`);
}

export { TTL_SECONDS as UPLOAD_TOKEN_TTL, PREFIX as UPLOAD_TOKEN_PREFIX };
