import { NextResponse } from "next/server";
import { redis } from "@/lib/kv";
import { sendAndLog } from "@/lib/resend";
import UnansweredReportEmail from "@/lib/email/templates/unanswered-report";

function getLastMonthKey(): { key: string; label: string } {
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const yyyy = lastMonth.getFullYear();
  const mm = String(lastMonth.getMonth() + 1).padStart(2, "0");
  const key = `unanswered:${yyyy}-${mm}`;
  const label = lastMonth.toLocaleDateString("en-AU", {
    month: "long",
    year: "numeric",
  });
  return { key, label };
}

function parseExplicitMonthKey(monthParam: string): { key: string; label: string } {
  // Accepts ?month=YYYY-MM for testing (bypasses "last month" logic)
  const match = monthParam.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!match) {
    throw new Error(`Invalid month parameter: "${monthParam}". Use YYYY-MM format.`);
  }
  const yyyy = parseInt(match[1], 10);
  const mmNum = parseInt(match[2], 10);
  const key = `unanswered:${match[1]}-${match[2]}`;
  const date = new Date(yyyy, mmNum - 1, 1);
  const label = date.toLocaleDateString("en-AU", {
    month: "long",
    year: "numeric",
  });
  return { key, label };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const explicitMonth = searchParams.get("month");
  let key: string;
  let label: string;

  if (explicitMonth) {
    try {
      ({ key, label } = parseExplicitMonthKey(explicitMonth));
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Invalid month" },
        { status: 400 }
      );
    }
  } else {
    ({ key, label } = getLastMonthKey());
  }

  // Auth only required for automated cron (no ?month param). The ?month= param
  // is a manual testing feature — Vercel Cron never passes query params.
  if (!explicitMonth) {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const authHeader = request.headers.get("authorization");
      if (authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
    } else {
      console.warn(
        "[cron] CRON_SECRET not set — accepting unauthenticated request (dev mode)"
      );
    }
  }

  const from = process.env.RESEND_FROM_EMAIL;
  const to = process.env.FIRM_NOTIFY_EMAIL;

  if (!from || !to) {
    console.error("[cron] RESEND_FROM_EMAIL or FIRM_NOTIFY_EMAIL not set", {
      event: "unanswered_report_config_missing",
    });
    return NextResponse.json(
      { error: "Email configuration missing" },
      { status: 500 }
    );
  }

  let questionCount = 0;
  const questions: Array<{ text: string; firstSeen: string }> = [];

  try {
    const rawResults = await redis.zrange(key, 0, -1, {
      withScores: true,
    });
    const results = rawResults as unknown as Array<{
      member: string;
      score: number;
    }>;
    questionCount = results.length;
    questions.push(
      ...results.map(({ member, score }) => ({
        text: member,
        firstSeen: new Date(score).toISOString(),
      }))
    );
  } catch (err) {
    console.error("[cron] failed to read unanswered questions", {
      event: "unanswered_report_read_failed",
      key,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Failed to read unanswered questions" },
      { status: 500 }
    );
  }

  try {
    await sendAndLog(
      {
        from,
        to,
        subject: `Unanswered Questions Report — ${label}`,
        react: UnansweredReportEmail({
          month: label,
          questionCount,
          questions,
        }),
      },
      { event: "sendUnansweredReport" }
    );
  } catch (err) {
    console.error("[cron] failed to send unanswered report email", {
      event: "unanswered_report_send_failed",
      key,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Failed to send report email" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    status: "ok",
    month: label,
    questionCount,
  });
}
