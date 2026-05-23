import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readKnowledgeGapsForMonth: vi.fn(),
  sendAndLog: vi.fn(),
}));

vi.mock("@/lib/tools/log-unanswered", () => ({
  readKnowledgeGapsForMonth: mocks.readKnowledgeGapsForMonth,
}));

vi.mock("@/lib/resend", () => ({
  sendAndLog: mocks.sendAndLog,
}));

import { GET } from "@/app/api/cron/unanswered-report/route";

function request(url: string, headers?: HeadersInit): Request {
  return new Request(url, { headers });
}

describe("GET /api/cron/unanswered-report", () => {
  const originalEnv = process.env;

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      RESEND_FROM_EMAIL: "Aquarius <reports@example.com>",
      KNOWLEDGE_GAP_REPORT_EMAIL: "kb@example.com",
      CRON_SECRET: "secret",
    };
    mocks.readKnowledgeGapsForMonth.mockResolvedValue([
      {
        normalized: "can i get bail",
        text: "Can I get bail?",
        timesAsked: 3,
        category: "Current Coverage Gap",
      },
      {
        normalized: "do you do divorce",
        text: "Do you do divorce?",
        timesAsked: 1,
        category: "Future Practice-Area Signal",
      },
    ]);
    mocks.sendAndLog.mockResolvedValue({ id: "email_123" });
  });

  it("uses explicit month for manual testing and sends to the knowledge gap recipient", async () => {
    const res = await GET(
      request("http://test/api/cron/unanswered-report?month=2026-05")
    );

    await expect(res.json()).resolves.toEqual({
      status: "ok",
      month: "May 2026",
      gapCount: 2,
      totalTimesAsked: 4,
    });
    expect(mocks.readKnowledgeGapsForMonth).toHaveBeenCalledWith("2026-05");
    expect(mocks.sendAndLog).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Aquarius <reports@example.com>",
        to: "kb@example.com",
        subject: "Knowledge Gap Report — May 2026",
      }),
      { event: "sendKnowledgeGapReport" }
    );
  });

  it("sends a zero-gap report instead of skipping the month", async () => {
    mocks.readKnowledgeGapsForMonth.mockResolvedValueOnce([]);

    const res = await GET(
      request("http://test/api/cron/unanswered-report?month=2026-05")
    );

    await expect(res.json()).resolves.toEqual({
      status: "ok",
      month: "May 2026",
      gapCount: 0,
      totalTimesAsked: 0,
    });
    expect(mocks.sendAndLog).toHaveBeenCalledOnce();
  });

  it("requires cron auth when no explicit month is provided", async () => {
    const res = await GET(request("http://test/api/cron/unanswered-report"));

    expect(res.status).toBe(401);
    expect(mocks.sendAndLog).not.toHaveBeenCalled();
  });

  it("fails configuration when the knowledge gap recipient is missing", async () => {
    delete process.env.KNOWLEDGE_GAP_REPORT_EMAIL;

    const res = await GET(
      request("http://test/api/cron/unanswered-report?month=2026-05")
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: "Email configuration missing",
    });
    expect(mocks.sendAndLog).not.toHaveBeenCalled();
  });
});
