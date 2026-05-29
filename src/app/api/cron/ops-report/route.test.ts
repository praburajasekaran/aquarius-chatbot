import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readOpsEventsForReport: vi.fn(),
  shouldSendOpsReport: vi.fn(),
  markOpsReportSent: vi.fn(),
  sendAndLog: vi.fn(),
}));

vi.mock("@/lib/ops-events", () => {
  return {
    readOpsEventsForReport: mocks.readOpsEventsForReport,
    shouldSendOpsReport: mocks.shouldSendOpsReport,
    markOpsReportSent: mocks.markOpsReportSent,
    summarizeOpsEvents: (events: { severity: "error" | "warning" | "info" }[]) => ({
      bySeverity: {
        error: events.filter((event) => event.severity === "error").length,
        warning: events.filter((event) => event.severity === "warning").length,
        info: events.filter((event) => event.severity === "info").length,
      },
      topEvents: [],
      topAreas: [],
      uploadSuccesses: 0,
      uploadFailures: 0,
      largestUploadBytes: 0,
      recentHighPriority: [],
    }),
  };
});

vi.mock("@/lib/resend", () => ({
  sendAndLog: mocks.sendAndLog,
}));

import { GET } from "@/app/api/cron/ops-report/route";

function request(headers?: HeadersInit): Request {
  return new Request("http://test/api/cron/ops-report", { headers });
}

describe("GET /api/cron/ops-report", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      CRON_SECRET: "secret",
      RESEND_FROM_EMAIL: "Aquarius <reports@example.com>",
      OPS_REPORT_EMAIL: "ops@example.com",
    };
    mocks.readOpsEventsForReport.mockResolvedValue([]);
    mocks.shouldSendOpsReport.mockResolvedValue(true);
    mocks.markOpsReportSent.mockResolvedValue(undefined);
    mocks.sendAndLog.mockResolvedValue({ id: "email_123" });
  });

  it("requires cron auth", async () => {
    const res = await GET(request());

    expect(res.status).toBe(401);
    expect(mocks.sendAndLog).not.toHaveBeenCalled();
  });

  it("sends the report to OPS_REPORT_EMAIL", async () => {
    const res = await GET(request({ authorization: "Bearer secret" }));

    expect(res.status).toBe(200);
    expect(mocks.sendAndLog).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Aquarius <reports@example.com>",
        to: "ops@example.com",
        subject: expect.stringContaining("Ops Report"),
      }),
      { event: "sendOpsReport" }
    );
    expect(mocks.markOpsReportSent).toHaveBeenCalledOnce();
  });

  it("skips duplicate weekly cron runs inside the fortnight", async () => {
    mocks.shouldSendOpsReport.mockResolvedValueOnce(false);

    const res = await GET(request({ authorization: "Bearer secret" }));

    await expect(res.json()).resolves.toEqual({
      status: "skipped",
      reason: "already_sent_recently",
    });
    expect(mocks.sendAndLog).not.toHaveBeenCalled();
  });

  it("fails configuration when OPS_REPORT_EMAIL is missing", async () => {
    delete process.env.OPS_REPORT_EMAIL;

    const res = await GET(request({ authorization: "Bearer secret" }));

    expect(res.status).toBe(500);
    expect(mocks.sendAndLog).not.toHaveBeenCalled();
  });
});
