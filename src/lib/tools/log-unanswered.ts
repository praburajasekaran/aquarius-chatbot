import { redis } from "@/lib/kv";

export interface KnowledgeGap {
  normalized: string;
  text: string;
  timesAsked: number;
  category: string;
}

export const KNOWLEDGE_GAP_TTL = 60 * 60 * 24 * 62; // 62 days (~2 months)

export function sanitizeKnowledgeGapWording(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email removed]")
    .replace(
      /(?<!\w)(?:\+?61|0)(?:[\s().-]*\d){8,10}(?!\w)/g,
      "[phone removed]"
    )
    .replace(
      /\b(?:ref(?:erence)?|payment|receipt|invoice|matter|case|session)\s*(?:ref(?:erence)?|no\.?|number|id|#|:)?\s*[A-Z0-9-]*\d[A-Z0-9-]{5,}\b/gi,
      "[reference removed]"
    )
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeKnowledgeGapQuestion(text: string): string {
  return sanitizeKnowledgeGapWording(text)
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

export function categorizeKnowledgeGap(text: string): string {
  const normalized = normalizeKnowledgeGapQuestion(text);

  if (
    /\b(divorce|separation|custody|parenting|child support|property settlement|family law)\b/.test(
      normalized
    ) ||
    /\b(will|estate|probate|conveyancing|property purchase|lease|employment|unfair dismissal|immigration|visa|personal injury|commercial|business dispute)\b/.test(
      normalized
    )
  ) {
    return "Future Practice-Area Signal";
  }

  if (
    /\b(fee|fees|cost|costs|price|pricing|payment|pay|appointment|book|booking|consult|consultation|location|office|hours|availability)\b/.test(
      normalized
    )
  ) {
    return "Firm Logistics / Fees";
  }

  if (
    /\b(bail|charge|charged|court|police|arrest|arrested|avo|breach|assault|drug|drugs|drink driving|dui|licence|license|speeding|fraud|theft|criminal|sentence|sentencing|fine|appeal)\b/.test(
      normalized
    )
  ) {
    return "Current Coverage Gap";
  }

  return "General Information Gap";
}

export function knowledgeGapMonthId(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

export function knowledgeGapMonthKey(monthId: string): string {
  return `knowledge-gaps:${monthId}`;
}

function knowledgeGapRecordKey(monthId: string, normalized: string): string {
  return `knowledge-gap:${monthId}:${encodeURIComponent(normalized)}`;
}

function parseTimesAsked(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export async function logUnanswered(
  question: string,
  sessionId = "unknown",
  date: Date = new Date()
): Promise<void> {
  const text = sanitizeKnowledgeGapWording(question);
  const normalized = normalizeKnowledgeGapQuestion(text);
  if (!normalized) return;

  const monthId = knowledgeGapMonthId(date);
  const monthKey = knowledgeGapMonthKey(monthId);
  const recordKey = knowledgeGapRecordKey(monthId, normalized);
  const score = date.getTime();
  const category = categorizeKnowledgeGap(text);

  try {
    await redis.zadd(monthKey, { score, member: normalized });
    await redis.hset(recordKey, { normalized, category });
    await redis.hsetnx(recordKey, "text", text);
    await redis.hincrby(recordKey, "timesAsked", 1);
    await redis.expire(monthKey, KNOWLEDGE_GAP_TTL);
    await redis.expire(recordKey, KNOWLEDGE_GAP_TTL);
  } catch (err) {
    console.error("[kb] failed to log knowledge gap", {
      event: "knowledge_gap_log_failed",
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function readKnowledgeGapsForMonth(
  monthId: string
): Promise<KnowledgeGap[]> {
  const normalizedQuestions = await redis.zrange<string[]>(
    knowledgeGapMonthKey(monthId),
    0,
    -1
  );

  const gaps = await Promise.all(
    normalizedQuestions.map(async (normalized) => {
      const record = await redis.hgetall<{
        normalized?: string;
        text?: string;
        timesAsked?: number | string;
        category?: string;
      }>(knowledgeGapRecordKey(monthId, normalized));

      if (!record?.text) return null;

      return {
        normalized: record.normalized ?? normalized,
        text: record.text,
        timesAsked: parseTimesAsked(record.timesAsked),
        category: record.category ?? "General Information Gap",
      };
    })
  );

  return gaps
    .filter((gap): gap is KnowledgeGap => Boolean(gap))
    .sort((a, b) => {
      if (b.timesAsked !== a.timesAsked) return b.timesAsked - a.timesAsked;
      return a.text.localeCompare(b.text, "en-AU");
    });
}
