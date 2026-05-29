import { redis } from "@/lib/kv";

export type OpsEventSeverity = "info" | "warning" | "error";

export interface OpsEventInput {
  severity: OpsEventSeverity;
  event: string;
  area: string;
  message: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  now?: Date;
}

export interface OpsEventRecord {
  severity: OpsEventSeverity;
  event: string;
  area: string;
  message: string;
  ts: string;
  sessionId?: string;
  metadata: Record<string, string | number | boolean | null>;
}

const OPS_EVENT_TTL_SECONDS = 21 * 24 * 60 * 60;
const MAX_TEXT_LENGTH = 240;
const MAX_METADATA_KEYS = 12;
const REPORT_SENT_KEY = "ops-report:last-sent";

function dateId(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function opsEventKey(date: Date = new Date()): string {
  return `ops-events:${dateId(date)}`;
}

function sanitizeString(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email removed]")
    .replace(/(?:\+?61|0)4\d(?:[\s-]?\d){7}/g, "[phone removed]")
    .replace(/[A-Za-z0-9_-]{24,}/g, "[token removed]")
    .slice(0, MAX_TEXT_LENGTH);
}

function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined
): Record<string, string | number | boolean | null> {
  if (!metadata) return {};

  const safe: Record<string, string | number | boolean | null> = {};
  for (const [rawKey, rawValue] of Object.entries(metadata).slice(0, MAX_METADATA_KEYS)) {
    const key = sanitizeString(rawKey).replace(/[^a-zA-Z0-9_.:-]/g, "_");
    if (!key) continue;

    if (
      rawValue === null ||
      typeof rawValue === "number" ||
      typeof rawValue === "boolean"
    ) {
      safe[key] = rawValue;
      continue;
    }

    if (typeof rawValue === "string") {
      safe[key] = sanitizeString(rawValue);
      continue;
    }

    if (rawValue instanceof Error) {
      safe[key] = sanitizeString(rawValue.message);
      continue;
    }

    safe[key] = sanitizeString(JSON.stringify(rawValue));
  }
  return safe;
}

export function createOpsEventRecord(input: OpsEventInput): OpsEventRecord {
  const now = input.now ?? new Date();
  return {
    severity: input.severity,
    event: sanitizeString(input.event),
    area: sanitizeString(input.area),
    message: sanitizeString(input.message),
    ts: now.toISOString(),
    ...(input.sessionId ? { sessionId: sanitizeString(input.sessionId) } : {}),
    metadata: sanitizeMetadata(input.metadata),
  };
}

export async function logOpsEvent(input: OpsEventInput): Promise<void> {
  const record = createOpsEventRecord(input);
  try {
    const key = opsEventKey(input.now);
    await redis.lpush(key, JSON.stringify(record));
    await redis.expire(key, OPS_EVENT_TTL_SECONDS);
  } catch (err) {
    console.warn("[ops-event] log failed", {
      event: "ops_event_log_failed",
      opsEvent: record.event,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export function logOpsEventSoon(input: OpsEventInput): void {
  void logOpsEvent(input);
}

export function eachReportDate(now: Date = new Date(), days = 14): Date[] {
  const dates: Date[] = [];
  const start = new Date(now);
  start.setUTCHours(12, 0, 0, 0);
  for (let i = 0; i < days; i++) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() - i);
    dates.push(date);
  }
  return dates;
}

export async function readOpsEventsForReport(
  now: Date = new Date(),
  days = 14
): Promise<OpsEventRecord[]> {
  const pages = await Promise.all(
    eachReportDate(now, days).map(async (date) => {
      const entries = await redis.lrange<string>(opsEventKey(date), 0, -1);
      return entries
        .map((entry) => {
          try {
            return JSON.parse(entry) as OpsEventRecord;
          } catch {
            return null;
          }
        })
        .filter((entry): entry is OpsEventRecord => Boolean(entry));
    })
  );
  return pages.flat().sort((a, b) => b.ts.localeCompare(a.ts));
}

export async function shouldSendOpsReport(
  now: Date = new Date(),
  minIntervalDays = 14
): Promise<boolean> {
  const lastSent = await redis.get<string>(REPORT_SENT_KEY);
  if (!lastSent) return true;
  const lastMs = Date.parse(lastSent);
  if (!Number.isFinite(lastMs)) return true;
  return now.getTime() - lastMs >= minIntervalDays * 24 * 60 * 60 * 1000;
}

export async function markOpsReportSent(now: Date = new Date()): Promise<void> {
  await redis.set(REPORT_SENT_KEY, now.toISOString(), {
    ex: OPS_EVENT_TTL_SECONDS,
  });
}

export function summarizeOpsEvents(events: OpsEventRecord[]) {
  const bySeverity = { error: 0, warning: 0, info: 0 };
  const byEvent = new Map<string, number>();
  const byArea = new Map<string, number>();
  let uploadSuccesses = 0;
  let uploadFailures = 0;
  let largestUploadBytes = 0;

  for (const event of events) {
    bySeverity[event.severity] += 1;
    byEvent.set(event.event, (byEvent.get(event.event) ?? 0) + 1);
    byArea.set(event.area, (byArea.get(event.area) ?? 0) + 1);

    if (event.event.includes("upload_success")) {
      uploadSuccesses += 1;
      const maxFileBytes = event.metadata.maxFileBytes;
      if (typeof maxFileBytes === "number") {
        largestUploadBytes = Math.max(largestUploadBytes, maxFileBytes);
      }
    }
    if (
      event.area.includes("upload") &&
      (event.severity === "error" || event.severity === "warning")
    ) {
      uploadFailures += 1;
    }
  }

  const top = (map: Map<string, number>) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

  return {
    bySeverity,
    topEvents: top(byEvent),
    topAreas: top(byArea),
    uploadSuccesses,
    uploadFailures,
    largestUploadBytes,
    recentHighPriority: events
      .filter((event) => event.severity === "error" || event.severity === "warning")
      .slice(0, 12),
  };
}
