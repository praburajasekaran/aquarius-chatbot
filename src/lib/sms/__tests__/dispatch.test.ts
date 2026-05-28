import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendSms, toE164AU } from "../dispatch";
import { IMMEDIATE_SMS_COPY } from "../copy";

describe("toE164AU (SMS-03)", () => {
  it("converts a spaced AU mobile to E.164", () => {
    expect(toE164AU("0412 345 678")).toBe("+61412345678");
  });

  it("is idempotent on already-E.164 input", () => {
    expect(toE164AU("+61412345678")).toBe("+61412345678");
  });
});

describe("sendSms — landline skip (SMS-04 + OPS-03)", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    process.env.CLICKSEND_USERNAME = "user";
    process.env.CLICKSEND_API_KEY = "key";
    process.env.CLICKSEND_SENDER_ID = "AquariusLaw";
    process.env.CLICKSEND_SENDER_COUNTRY = "AU";
    process.env.CLICKSEND_SENDER_TYPE = "alpha_tag";
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.CLICKSEND_USERNAME;
    delete process.env.CLICKSEND_API_KEY;
    delete process.env.CLICKSEND_SENDER_ID;
    delete process.env.CLICKSEND_SENDER_COUNTRY;
    delete process.env.CLICKSEND_SENDER_TYPE;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("skips landline numbers, never calls fetch, logs sms_skipped reason=landline, no raw digits", async () => {
    await sendSms("02 9876 5432", "hello");
    expect(fetch).not.toHaveBeenCalled();

    const allCalls = [
      ...infoSpy.mock.calls,
      ...warnSpy.mock.calls,
      ...errorSpy.mock.calls,
    ];
    const flat = JSON.stringify(allCalls);
    expect(flat).toContain("sms_skipped");
    expect(flat).toContain("landline");
    // OPS-03: raw phone digits must NEVER appear in any log call
    expect(flat).not.toContain("0298765432");
    expect(flat).not.toContain("+61298765432");
  });
});

describe("sendSms — masked logging on successful send (OPS-03)", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => '{"data":{"messages":[{"message_id":"x"}]}}',
      })
    );
    process.env.CLICKSEND_USERNAME = "user";
    process.env.CLICKSEND_API_KEY = "key";
    process.env.CLICKSEND_SENDER_ID = "AquariusLaw";
    process.env.CLICKSEND_SENDER_COUNTRY = "AU";
    process.env.CLICKSEND_SENDER_TYPE = "alpha_tag";
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.CLICKSEND_USERNAME;
    delete process.env.CLICKSEND_API_KEY;
    delete process.env.CLICKSEND_SENDER_ID;
    delete process.env.CLICKSEND_SENDER_COUNTRY;
    delete process.env.CLICKSEND_SENDER_TYPE;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("logs only masked phone — raw E.164 never appears in any console.info call", async () => {
    await sendSms("+61412345678", "hello");
    const flat = JSON.stringify(infoSpy.mock.calls);
    expect(flat).not.toContain("+61412345678");
    // Masked form: at least one '*' between +61 and last 4 digits 5678
    expect(flat).toMatch(/\+61\*+5678/);
  });

  it("uses the approved AU Alpha Tag sender via ClickSend senders array", async () => {
    await sendSms("+61412345678", "hello");

    expect(fetch).toHaveBeenCalledWith(
      "https://rest.clicksend.com/v3/sms/send",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          senders: [
            {
              country_code: "AU",
              sender_type: "alpha_tag",
              sender_id: "AquariusLaw",
            },
          ],
          messages: [
            {
              to: "+61412345678",
              body: "hello",
              source: "aquariuslaw-app",
            },
          ],
        }),
      })
    );
  });
});

describe("sendSms — absent-env graceful degradation (OPS-01 / TEST-01)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.CLICKSEND_USERNAME;
    delete process.env.CLICKSEND_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("warns and returns without throwing when CLICKSEND_* env vars are absent — no fetch call", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(sendSms("+61412345678", "hello")).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    const flat = JSON.stringify(warnSpy.mock.calls);
    expect(flat).toContain("CLICKSEND");
    expect(flat.toLowerCase()).toContain("missing");
  });
});

describe("IMMEDIATE_SMS_COPY (COMP-01 + COMP-02)", () => {
  it("contains firm name, upload link, contact phone digits; no Reply STOP, no promo words", () => {
    const link = "https://example.com/u/abc";
    const copy = IMMEDIATE_SMS_COPY(link);

    expect(copy).toContain("Aquarius Lawyers");
    expect(copy).toContain(link);
    // Must contain the firm contact phone digits (from src/lib/contact.ts: +61 2 8858 3233)
    expect(copy).toContain("8858");

    const lower = copy.toLowerCase();
    expect(lower).not.toContain("reply stop");
    expect(lower).not.toContain("best");
    expect(lower).not.toContain("trusted");
    expect(lower).not.toContain("award");
    expect(lower).not.toContain("book now");
  });
});
