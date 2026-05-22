import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ============ Mocks (declared BEFORE imports of modules under test) ============
// Per the v1.0 sms reminder.test.ts pattern: external boundaries only — never
// mock the modules under test (../dispatch, ../unsubscribe, ../state,
// @/lib/digest/activity-log, @/app/api/webhooks/email-reminder/route).

vi.mock("@/lib/kv", () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    lpush: vi.fn(),
    expire: vi.fn(),
  },
}));

const publishJSONMock = vi.fn();
const cancelMessagesMock = vi.fn();
vi.mock("@upstash/qstash", () => ({
  // Vitest 4: `vi.fn().mockImplementation(arrow)` is not newable because
  // arrow functions cannot be constructors. Use a `function` so `new Client()`
  // is well-formed. (Mirror this in the resend mock below.)
  Client: vi.fn(function (this: unknown) {
    return {
      publishJSON: publishJSONMock,
      messages: { cancel: cancelMessagesMock },
    };
  }),
}));

// verifySignatureAppRouter is a HOC; passthrough so unit tests reach the inner
// handler without needing real signing keys.
vi.mock("@upstash/qstash/nextjs", () => ({
  verifySignatureAppRouter:
    (handler: (req: Request) => Promise<Response>) => handler,
}));

const resendSendMock = vi.fn();
vi.mock("resend", () => ({
  // Vitest 4: see comment above @upstash/qstash mock — arrow-impl ctors break.
  Resend: vi.fn(function (this: unknown) {
    return {
      emails: { send: resendSendMock },
      domains: { list: vi.fn().mockResolvedValue({ data: [], error: null }) },
    };
  }),
}));

vi.mock("@/lib/email/assert-no-tracking", () => ({
  assertNoResendTracking: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/intake", () => ({
  getIntake: vi.fn().mockResolvedValue({
    sessionId: "sess-fixture",
    clientName: "Test Client",
    clientEmail: "client@test.invalid",
    clientPhone: "+61400000000",
    matterDescription:
      "First sentence about a matter. Second sentence.",
    urgency: "non-urgent",
    displayPrice: "$726",
    amountCents: 72600,
  }),
}));

// activity-log mock — partial: vi.importActual passthrough for the real
// `logActivity` (test 9 asserts isolation behaviour against the real catch
// branch), but the mock declaration itself is the contract surface that
// Plan 04-02's implementation must satisfy. When 04-02 lands the real
// module, the importActual passthrough lets test 9 exercise real isolation.
vi.mock("@/lib/digest/activity-log", async () => {
  const actual = await vi.importActual<{
    logActivity: (...args: unknown[]) => Promise<void>;
  }>("@/lib/digest/activity-log");
  return { ...actual };
});

// ============ Imports of modules under test ============
// These imports will FAIL until plans 04-02 (dispatch, unsubscribe, state,
// activity-log) and 04-03 (route file) land. That RED state is intentional.

import { redis } from "@/lib/kv";
import {
  scheduleEmailReminder,
  cancelEmailReminder,
} from "../dispatch";
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from "../unsubscribe";
import { logActivity } from "@/lib/digest/activity-log";
import { handleEmailReminderDelivery } from "@/app/api/webhooks/email-reminder/route";

// ============ Helpers ============

function makeDeliveryRequest(body: object): Request {
  return new Request("http://localhost/api/webhooks/email-reminder", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset env between tests so absent-env tests are deterministic.
  delete process.env.QSTASH_TOKEN;
  delete process.env.APP_URL;
  delete process.env.EMAIL_REMINDER_UNSUBSCRIBE_SECRET;
  delete process.env.RESEND_FROM_EMAIL;
  delete process.env.RESEND_API_KEY;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.QSTASH_TOKEN;
  delete process.env.APP_URL;
  delete process.env.EMAIL_REMINDER_UNSUBSCRIBE_SECRET;
  delete process.env.RESEND_FROM_EMAIL;
  delete process.env.RESEND_API_KEY;
});

// ============ 9 describe blocks, one per behaviour ============

describe("scheduleEmailReminder — absent QSTASH_TOKEN (OPS-V1.1-01)", () => {
  it("warns with email_reminder_skipped/no_qstash_token, never sets redis or publishes, does not throw", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.APP_URL = "https://app.test";
    // QSTASH_TOKEN intentionally absent.

    await expect(
      scheduleEmailReminder("payment-abandonment-1h", "sess-A", 3600)
    ).resolves.toBeUndefined();

    const flat = JSON.stringify(warnSpy.mock.calls.flat());
    expect(flat).toContain("email_reminder_skipped");
    expect(flat).toContain("no_qstash_token");
    expect(vi.mocked(redis.set)).not.toHaveBeenCalled();
    expect(publishJSONMock).not.toHaveBeenCalled();
  });
});

describe("scheduleEmailReminder — happy path stores messageId with delay+7200 TTL (INFRA-02)", () => {
  it("publishes to QStash with delay=3600 and stores messageId in redis with ex=10800 (3600+7200)", async () => {
    process.env.QSTASH_TOKEN = "tok";
    process.env.APP_URL = "https://app.test";
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    publishJSONMock.mockResolvedValue({
      messageId: "msg-qstash-1h",
      url: "https://app.test/api/webhooks/email-reminder",
    });

    await scheduleEmailReminder("payment-abandonment-1h", "sess-B", 3600);

    expect(publishJSONMock).toHaveBeenCalledOnce();
    expect(publishJSONMock).toHaveBeenCalledWith({
      url: "https://app.test/api/webhooks/email-reminder",
      body: { sessionId: "sess-B", type: "payment-abandonment-1h" },
      delay: 3600,
    });
    expect(vi.mocked(redis.set)).toHaveBeenCalledOnce();
    expect(vi.mocked(redis.set)).toHaveBeenCalledWith(
      "email-reminder:payment-abandonment-1h:sess-B",
      "msg-qstash-1h",
      { ex: 10800 }
    );
    const flat = JSON.stringify(infoSpy.mock.calls.flat());
    expect(flat).toContain("email_reminder_scheduled");
    expect(flat).toContain("payment-abandonment-1h");
    expect(flat).toContain("sess-B");
  });
});

describe("cancelEmailReminder — idempotent: second call no-ops (INFRA-06)", () => {
  it("first call cancels and deletes; second call is a no-op (no cancel, no throw)", async () => {
    process.env.QSTASH_TOKEN = "tok";

    // First call — key present, cancel + del happen.
    vi.mocked(redis.get).mockResolvedValueOnce("msg-qstash-X" as never);
    cancelMessagesMock.mockResolvedValueOnce(undefined);
    vi.mocked(redis.del).mockResolvedValueOnce(1 as never);

    await cancelEmailReminder("payment-abandonment-1h", "sess-C");

    expect(cancelMessagesMock).toHaveBeenCalledTimes(1);
    expect(cancelMessagesMock).toHaveBeenCalledWith("msg-qstash-X");
    expect(vi.mocked(redis.del)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(redis.del)).toHaveBeenCalledWith(
      "email-reminder:payment-abandonment-1h:sess-C"
    );

    // Second call — key absent (already deleted) → must be a no-op.
    vi.mocked(redis.get).mockResolvedValueOnce(null as never);

    await expect(
      cancelEmailReminder("payment-abandonment-1h", "sess-C")
    ).resolves.toBeUndefined();

    // cancel was called exactly ONCE across both invocations.
    expect(cancelMessagesMock).toHaveBeenCalledTimes(1);
    expect(vi.mocked(redis.del)).toHaveBeenCalledTimes(1);
  });
});

describe("handleEmailReminderDelivery — gates run before NX dedup write (INFRA-04, INFRA-05)", () => {
  it("checks payment-completed and unsubscribe BEFORE NX-setting email-reminder-sent with ex=604800; sends only after NX OK", async () => {
    process.env.RESEND_FROM_EMAIL = "noreply@test.invalid";
    process.env.RESEND_API_KEY = "re_test";

    // redis.get → null for every gate read.
    vi.mocked(redis.get).mockResolvedValue(null as never);
    // redis.set NX returns "OK" — first delivery wins.
    vi.mocked(redis.set).mockResolvedValue("OK" as never);
    resendSendMock.mockResolvedValue({ id: "resend-msg-1" });

    const res = await handleEmailReminderDelivery(
      makeDeliveryRequest({
        sessionId: "sess-D",
        type: "payment-abandonment-1h",
      })
    );

    // Gate 1: payment-completed:sess-D was read.
    expect(vi.mocked(redis.get)).toHaveBeenCalledWith(
      "payment-completed:sess-D"
    );
    // Gate 2: unsubscribe:sess-D was read.
    expect(vi.mocked(redis.get)).toHaveBeenCalledWith("unsubscribe:sess-D");
    // NX dedup write with locked key + ex=604800 (7d, INFRA-05).
    expect(vi.mocked(redis.set)).toHaveBeenCalledWith(
      "email-reminder-sent:payment-abandonment-1h:sess-D",
      "1",
      { nx: true, ex: 604800 }
    );

    // Ordering: every redis.get gate ran BEFORE the NX redis.set.
    const setOrder = vi.mocked(redis.set).mock.invocationCallOrder[0];
    const getOrders = vi.mocked(redis.get).mock.invocationCallOrder;
    expect(getOrders.length).toBeGreaterThanOrEqual(2);
    for (const o of getOrders) {
      expect(o).toBeLessThan(setOrder);
    }

    // Resend.send fires AFTER NX-set succeeded.
    expect(resendSendMock).toHaveBeenCalledTimes(1);
    const sendOrder = resendSendMock.mock.invocationCallOrder[0];
    expect(sendOrder).toBeGreaterThan(setOrder);

    // Response is a 200 with a success-shaped body.
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body.toLowerCase()).toMatch(/ok|sent|delivered/);
  });
});

describe("handleEmailReminderDelivery — payment-completed gate short-circuits (INFRA-04)", () => {
  it("skips dispatch when payment-completed:{sessionId} exists; never calls Resend or NX-set", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    vi.mocked(redis.get).mockImplementation(async (key: string) => {
      if (key === "payment-completed:sess-E") return "1" as never;
      return null as never;
    });

    const res = await handleEmailReminderDelivery(
      makeDeliveryRequest({
        sessionId: "sess-E",
        type: "payment-abandonment-1h",
      })
    );

    const body = await res.text();
    expect(body.toLowerCase()).toContain("skipped");
    expect(resendSendMock).not.toHaveBeenCalled();
    // NX-set for email-reminder-sent must never be written.
    const setCalls = vi.mocked(redis.set).mock.calls;
    for (const [key] of setCalls) {
      expect(String(key)).not.toMatch(/^email-reminder-sent:/);
    }

    const flat = JSON.stringify(infoSpy.mock.calls.flat());
    expect(flat).toContain("email_reminder_skipped");
    expect(flat).toContain("payment_completed");
  });
});

describe("handleEmailReminderDelivery — unsubscribe gate short-circuits (INFRA-04)", () => {
  it("skips dispatch when unsubscribe:{sessionId} exists; never calls Resend", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    vi.mocked(redis.get).mockImplementation(async (key: string) => {
      if (key === "payment-completed:sess-F") return null as never;
      if (key === "unsubscribe:sess-F") return "1" as never;
      return null as never;
    });

    const res = await handleEmailReminderDelivery(
      makeDeliveryRequest({
        sessionId: "sess-F",
        type: "payment-abandonment-1h",
      })
    );

    const body = await res.text();
    expect(body.toLowerCase()).toContain("skipped");
    expect(resendSendMock).not.toHaveBeenCalled();
    const flat = JSON.stringify(infoSpy.mock.calls.flat());
    expect(flat).toContain("email_reminder_skipped");
    expect(flat).toContain("unsubscribed");
  });
});

describe("unsubscribe HMAC — sign and verify round-trip (INFRA-07)", () => {
  it("sign returns a base64url-shaped non-empty string; verify returns true for the matching sessionId", () => {
    process.env.EMAIL_REMINDER_UNSUBSCRIBE_SECRET = "test-secret-1";

    const tok = signUnsubscribeToken("sess-G");
    expect(tok).toBeTruthy();
    expect(typeof tok).toBe("string");
    // Base64url shape: only [A-Za-z0-9_-], no '=' padding, no '+' or '/'.
    expect(tok!).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(tok!).not.toContain("=");
    expect(tok!).not.toContain("+");
    expect(tok!).not.toContain("/");

    const ok = verifyUnsubscribeToken("sess-G", tok!);
    expect(ok).toBe(true);
  });
});

describe("unsubscribe HMAC — wrong secret AND wrong sessionId rejected (INFRA-07)", () => {
  it("token signed with secret-A fails verify under secret-B; token bound to sess-H fails verify against sess-I", () => {
    process.env.EMAIL_REMINDER_UNSUBSCRIBE_SECRET = "secret-A";
    const tokA = signUnsubscribeToken("sess-H");
    expect(tokA).toBeTruthy();

    // Switch to a different secret — verify must fail.
    process.env.EMAIL_REMINDER_UNSUBSCRIBE_SECRET = "secret-B";
    expect(verifyUnsubscribeToken("sess-H", tokA!)).toBe(false);

    // Restore original secret — same token under a DIFFERENT sessionId fails.
    process.env.EMAIL_REMINDER_UNSUBSCRIBE_SECRET = "secret-A";
    expect(verifyUnsubscribeToken("sess-I", tokA!)).toBe(false);

    // Sanity: under correct secret + correct session, it still works.
    expect(verifyUnsubscribeToken("sess-H", tokA!)).toBe(true);
  });
});

describe("absent UNSUBSCRIBE_SECRET + activity-log isolation (OPS-V1.1-01, Decision 3)", () => {
  it("signUnsubscribeToken returns null + warns when secret absent; logActivity does not throw on redis failure", async () => {
    // Part 1: signUnsubscribeToken absent-env behaviour.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    delete process.env.EMAIL_REMINDER_UNSUBSCRIBE_SECRET;

    const tok = signUnsubscribeToken("sess-J");
    expect(tok).toBeNull();
    const flatPart1 = JSON.stringify(warnSpy.mock.calls.flat());
    expect(flatPart1).toContain("unsubscribe");

    // Part 2: logActivity isolation when redis.lpush throws.
    warnSpy.mockClear();
    vi.mocked(redis.lpush).mockRejectedValueOnce(
      new Error("redis offline") as never
    );

    await expect(
      logActivity("lead_created", "sess-K", { foo: "bar" })
    ).resolves.toBeUndefined();

    const flatPart2 = JSON.stringify(warnSpy.mock.calls.flat());
    expect(flatPart2).toContain("activity_log_failed");
  });
});
