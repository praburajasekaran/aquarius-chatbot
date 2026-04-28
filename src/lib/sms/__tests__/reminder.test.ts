import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock external dependencies BEFORE importing the modules under test.
vi.mock("@/lib/kv", () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock("@/lib/sms/dispatch", () => ({
  sendSms: vi.fn(),
}));

vi.mock("@/lib/sms/copy", () => ({
  REMINDER_SMS_COPY: (uploadLink: string) => `reminder body: ${uploadLink}`,
}));

// Mock @upstash/qstash with a Client class whose methods are vi.fn() spies.
const publishJSONMock = vi.fn();
const cancelMock = vi.fn();
vi.mock("@upstash/qstash", () => ({
  Client: vi.fn().mockImplementation(function () {
    return {
      publishJSON: publishJSONMock,
      messages: { cancel: cancelMock },
    };
  }),
}));

// verifySignatureAppRouter is a HOC; its presence is structural — return a passthrough.
vi.mock("@upstash/qstash/nextjs", () => ({
  verifySignatureAppRouter: (handler: (req: Request) => Promise<Response>) => handler,
}));

// Imports happen AFTER the mocks above.
import { redis } from "@/lib/kv";
import { sendSms } from "@/lib/sms/dispatch";
import {
  scheduleReminderSms,
  cancelPendingReminder,
} from "../reminder";
import { handleReminderDelivery } from "@/app/api/webhooks/sms-reminder/route";

function makeRequest(body: object): Request {
  return new Request("http://localhost/api/webhooks/sms-reminder", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("scheduleReminderSms — absent QSTASH_TOKEN (SCHED-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.QSTASH_TOKEN;
    delete process.env.APP_URL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.QSTASH_TOKEN;
    delete process.env.APP_URL;
  });

  it("warns with reminder_skipped/no_qstash_token, never sets redis, does not throw", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.APP_URL = "https://app.test";

    await scheduleReminderSms("s1", "+61412345678", "https://example.com/u/abc");

    const flat = JSON.stringify(warnSpy.mock.calls.flat());
    expect(flat).toContain("reminder_skipped");
    expect(flat).toContain("no_qstash_token");
    expect(vi.mocked(redis.set)).not.toHaveBeenCalled();
  });
});

describe("scheduleReminderSms — happy path stores messageId 26h (SCHED-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.QSTASH_TOKEN;
    delete process.env.APP_URL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.QSTASH_TOKEN;
    delete process.env.APP_URL;
  });

  it("publishes to QStash with 86400s delay and stores messageId in redis with 93600s TTL", async () => {
    process.env.QSTASH_TOKEN = "tok";
    process.env.APP_URL = "https://app.test";
    publishJSONMock.mockResolvedValue({ messageId: "msg-123", url: "https://app.test/api/webhooks/sms-reminder" });

    await scheduleReminderSms("sess-A", "+61412345678", "https://app.test/u/abc");

    expect(publishJSONMock).toHaveBeenCalledOnce();
    expect(publishJSONMock).toHaveBeenCalledWith({
      url: "https://app.test/api/webhooks/sms-reminder",
      body: { sessionId: "sess-A", phone: "+61412345678", uploadLink: "https://app.test/u/abc" },
      delay: 86400,
    });
    expect(vi.mocked(redis.set)).toHaveBeenCalledOnce();
    expect(vi.mocked(redis.set)).toHaveBeenCalledWith("sms-reminder:sess-A", "msg-123", { ex: 93600 });
  });
});

describe("cancelPendingReminder — reads messageId, calls cancel (SCHED-04)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.QSTASH_TOKEN;
    delete process.env.APP_URL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.QSTASH_TOKEN;
    delete process.env.APP_URL;
  });

  it("reads messageId from redis, calls messages.cancel, then deletes the redis key", async () => {
    process.env.QSTASH_TOKEN = "tok";
    vi.mocked(redis.get).mockResolvedValue("msg-456");
    cancelMock.mockResolvedValue(undefined);
    vi.mocked(redis.del).mockResolvedValue(1 as unknown as never);

    await cancelPendingReminder("sess-B");

    expect(vi.mocked(redis.get)).toHaveBeenCalledWith("sms-reminder:sess-B");
    expect(cancelMock).toHaveBeenCalledOnce();
    expect(cancelMock).toHaveBeenCalledWith("msg-456");
    expect(vi.mocked(redis.del)).toHaveBeenCalledWith("sms-reminder:sess-B");
  });
});

describe("handleReminderDelivery — uploaded flag short-circuit (SCHED-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.QSTASH_TOKEN;
    delete process.env.APP_URL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.QSTASH_TOKEN;
    delete process.env.APP_URL;
  });

  it("returns 'skipped' when uploaded flag is set, sendSms never called", async () => {
    vi.mocked(redis.get).mockResolvedValue("1");

    const res = await handleReminderDelivery(
      makeRequest({ sessionId: "sess-C", phone: "+61412345678", uploadLink: "https://app.test/u" })
    );

    expect(await res.text()).toBe("skipped");
    expect(vi.mocked(sendSms)).not.toHaveBeenCalled();
    expect(vi.mocked(redis.get)).toHaveBeenCalledWith("uploaded:sess-C");
  });
});

describe("handleReminderDelivery — NX dedup on second delivery (SCHED-05)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.QSTASH_TOKEN;
    delete process.env.APP_URL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.QSTASH_TOKEN;
    delete process.env.APP_URL;
  });

  it("returns 'deduped' when sms-reminder-sent NX set returns null (key already exists), sendSms never called", async () => {
    vi.mocked(redis.get).mockResolvedValue(null); // no upload flag
    vi.mocked(redis.set).mockResolvedValue(null); // NX failed — key already exists

    const res = await handleReminderDelivery(
      makeRequest({ sessionId: "sess-D", phone: "+61412345678", uploadLink: "https://app.test/u" })
    );

    expect(await res.text()).toBe("deduped");
    expect(vi.mocked(redis.set)).toHaveBeenCalledWith(
      "sms-reminder-sent:sess-D",
      "1",
      { nx: true, ex: 93600 }
    );
    expect(vi.mocked(sendSms)).not.toHaveBeenCalled();
  });
});
