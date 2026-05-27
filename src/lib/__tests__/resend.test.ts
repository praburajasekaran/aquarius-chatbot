import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resendSendMock = vi.fn();

vi.mock("resend", () => ({
  Resend: vi.fn(function (this: unknown) {
    return {
      emails: { send: resendSendMock },
    };
  }),
}));

describe("sendAndLog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    resendSendMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("retries Resend rate-limit responses before succeeding", async () => {
    const { sendAndLog } = await import("@/lib/resend");
    resendSendMock
      .mockResolvedValueOnce({
        data: null,
        error: {
          name: "rate_limit_exceeded",
          message: "Too many requests. You can only make 2 requests per second.",
        },
      })
      .mockResolvedValueOnce({
        data: { id: "email_123" },
        error: null,
      });

    const resultPromise = sendAndLog(
      {
        from: "from@example.com",
        to: "to@example.com",
        subject: "Hello",
        html: "<p>Hello</p>",
      },
      { event: "test_send", sessionId: "s_test" }
    );

    await vi.advanceTimersByTimeAsync(750);
    await expect(resultPromise).resolves.toEqual({ id: "email_123" });
    expect(resendSendMock).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledWith(
      "[resend] rate limited, retrying",
      expect.objectContaining({
        event: "resend_rate_limit_retry",
        retryDelayMs: 750,
      })
    );
  });

  it("does not retry non-rate-limit Resend rejections", async () => {
    const { sendAndLog } = await import("@/lib/resend");
    resendSendMock.mockResolvedValueOnce({
      data: null,
      error: {
        name: "validation_error",
        message: "Invalid recipient",
      },
    });

    await expect(
      sendAndLog(
        {
          from: "from@example.com",
          to: "bad",
          subject: "Hello",
          html: "<p>Hello</p>",
        },
        { event: "test_send", sessionId: "s_test" }
      )
    ).rejects.toThrow("Resend rejected: validation_error");
    expect(resendSendMock).toHaveBeenCalledOnce();
  });
});
