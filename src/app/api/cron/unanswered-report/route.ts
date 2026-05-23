import { NextResponse } from "next/server";
import { sendAndLog } from "@/lib/resend";
import UnansweredReportEmail from "@/lib/email/templates/unanswered-report";
import { readKnowledgeGapsForMonth } from "@/lib/tools/log-unanswered";

function getLastMonth(): { monthId: string; label: string } {
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const yyyy = lastMonth.getFullYear();
  const mm = String(lastMonth.getMonth() + 1).padStart(2, "0");
  const monthId = `${yyyy}-${mm}`;
  const label = lastMonth.toLocaleDateString("en-AU", {
    month: "long",
    year: "numeric",
  });
  return { monthId, label };
}

function parseExplicitMonth(monthParam: string): { monthId: string; label: string } {
  // Accepts ?month=YYYY-MM for testing (bypasses "last month" logic)
  const match = monthParam.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!match) {
    throw new Error(`Invalid month parameter: "${monthParam}". Use YYYY-MM format.`);
  }
  const yyyy = parseInt(match[1], 10);
  const mmNum = parseInt(match[2], 10);
  const monthId = `${match[1]}-${match[2]}`;
  const date = new Date(yyyy, mmNum - 1, 1);
  const label = date.toLocaleDateString("en-AU", {
    month: "long",
    year: "numeric",
  });
  return { monthId, label };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const explicitMonth = searchParams.get("month");
  let monthId: string;
  let label: string;

  if (explicitMonth) {
    try {
      ({ monthId, label } = parseExplicitMonth(explicitMonth));
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Invalid month" },
        { status: 400 }
      );
    }
  } else {
    ({ monthId, label } = getLastMonth());
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
  const to = process.env.KNOWLEDGE_GAP_REPORT_EMAIL;

  if (!from || !to) {
    console.error("[cron] RESEND_FROM_EMAIL or KNOWLEDGE_GAP_REPORT_EMAIL not set", {
      event: "knowledge_gap_report_config_missing",
    });
    return NextResponse.json(
      { error: "Email configuration missing" },
      { status: 500 }
    );
  }

  let gaps: Awaited<ReturnType<typeof readKnowledgeGapsForMonth>> = [];

  try {
    gaps = await readKnowledgeGapsForMonth(monthId);
  } catch (err) {
    console.error("[cron] failed to read knowledge gaps", {
      event: "knowledge_gap_report_read_failed",
      monthId,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Failed to read knowledge gaps" },
      { status: 500 }
    );
  }

  const totalTimesAsked = gaps.reduce((sum, gap) => sum + gap.timesAsked, 0);

  try {
    await sendAndLog(
      {
        from,
        to,
        subject: `Knowledge Gap Report — ${label}`,
        react: UnansweredReportEmail({
          month: label,
          gapCount: gaps.length,
          totalTimesAsked,
          gaps,
        }),
      },
      { event: "sendKnowledgeGapReport" }
    );
  } catch (err) {
    console.error("[cron] failed to send knowledge gap report email", {
      event: "knowledge_gap_report_send_failed",
      monthId,
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
    gapCount: gaps.length,
    totalTimesAsked,
  });
}
