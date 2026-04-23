import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const INTAKE_TTL_SECONDS = 60 * 60 * 24 * 7;

export type IntakeUrgency = "urgent" | "non-urgent";

export interface IntakeRecord {
  sessionId: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  matterDescription: string;
  urgency: IntakeUrgency;
  displayPrice: string;
  amountCents: number;
  bpointTxnNumber: string | null;
  createdAt: string;
  updatedAt: string;
}

export function intakeKey(sessionId: string): string {
  return `intake:${sessionId}`;
}

export async function createIntake(
  record: Omit<IntakeRecord, "createdAt" | "updatedAt" | "bpointTxnNumber"> & {
    bpointTxnNumber?: string | null;
  }
): Promise<IntakeRecord> {
  const now = new Date().toISOString();
  const full: IntakeRecord = {
    ...record,
    bpointTxnNumber: record.bpointTxnNumber ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await redis.set(intakeKey(record.sessionId), full, { ex: INTAKE_TTL_SECONDS });
  return full;
}

export async function getIntake(sessionId: string): Promise<IntakeRecord | null> {
  return redis.get<IntakeRecord>(intakeKey(sessionId));
}

export async function updateIntake(
  sessionId: string,
  patch: Partial<Omit<IntakeRecord, "sessionId" | "createdAt">>
): Promise<IntakeRecord | null> {
  const existing = await getIntake(sessionId);
  if (!existing) return null;
  const updated: IntakeRecord = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await redis.set(intakeKey(sessionId), updated, { ex: INTAKE_TTL_SECONDS });
  return updated;
}
