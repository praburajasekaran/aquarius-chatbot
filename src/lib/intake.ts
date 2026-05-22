import { redis } from "@/lib/kv";

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
  paymentRef: string | null;
  bpointAuthKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export function intakeKey(sessionId: string): string {
  return `intake:${sessionId}`;
}

export async function createIntake(
  record: Omit<
    IntakeRecord,
    "createdAt" | "updatedAt" | "paymentRef" | "bpointAuthKey"
  > & {
    paymentRef?: string | null;
    bpointAuthKey?: string | null;
  }
): Promise<IntakeRecord> {
  const now = new Date().toISOString();
  const full: IntakeRecord = {
    ...record,
    paymentRef: record.paymentRef ?? null,
    bpointAuthKey: record.bpointAuthKey ?? null,
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
