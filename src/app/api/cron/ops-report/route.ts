import { NextResponse } from "next/server";
import { sendAndLog } from "@/lib/resend";
import OpsReportEmail from "@/lib/email/templates/ops-report";
import {
  markOpsReportSent,
  readOpsEventsForReport,
  shouldSendOpsReport,
  summarizeOpsEvents,
} from "@/lib/ops-events";

export const runtime = "nodejs";
export const maxDuration = 30;

function fortnightLabel(now: Date): string {
  const end = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(now);
  const startDate = new Date(now);
  startDate.setUTCDate(now.getUTCDate() - 13);
  const start = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(startDate);
  return `${start} – ${end}`;
}

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[ops-report] CRON_SECRET missing", {
      event: "ops_report_config_missing",
    });
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const from = process.env.RESEND_FROM_EMAIL;
  const to = process.env.OPS_REPORT_EMAIL;
  if (!from || !to) {
    console.error("[ops-report] RESEND_FROM_EMAIL or OPS_REPORT_EMAIL missing", {
      event: "ops_report_email_config_missing",
    });
    return NextResponse.json({ error: "Email configuration missing" }, { status: 500 });
  }

  const now = new Date();
  if (!(await shouldSendOpsReport(now))) {
    return NextResponse.json({ status: "skipped", reason: "already_sent_recently" });
  }

  const events = await readOpsEventsForReport(now);
  const label = fortnightLabel(now);
  const summary = summarizeOpsEvents(events);

  await sendAndLog(
    {
      from,
      to,
      subject: `Ops Report — ${label}`,
      react: OpsReportEmail({ label, events }),
    },
    { event: "sendOpsReport" }
  );
  await markOpsReportSent(now);

  return NextResponse.json({
    status: "ok",
    label,
    events: events.length,
    errors: summary.bySeverity.error,
    warnings: summary.bySeverity.warning,
  });
}
