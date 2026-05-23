import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  logUnanswered: vi.fn(async () => undefined),
}));

// Mock external boundaries before importing the route. chatModel calls
// createOpenRouter at module load, redis touches Upstash, streamText would
// hit the provider — none of those should run under test.
vi.mock("@/lib/openrouter", () => ({
  chatModel: { __mock: "chatModel" },
}));

vi.mock("@/lib/tools/log-unanswered", () => ({
  logUnanswered: mocks.logUnanswered,
}));

vi.mock("@/lib/rate-limit", () => ({
  chatLimiter: {
    limit: vi.fn(async () => ({ success: true })),
  },
}));

vi.mock("@/lib/kv", () => ({
  redis: {
    set: vi.fn(async () => "OK"),
    get: vi.fn(async () => null),
    del: vi.fn(async () => 0),
  },
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>(
    "next/server"
  );
  return {
    ...actual,
    after: vi.fn(),
  };
});

// Spy on streamText so we can capture the converted messages without hitting
// a real model. convertToModelMessages must run for real — that is the unit
// under test.
const streamTextSpy = vi.fn();
vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    streamText: (args: unknown) => {
      streamTextSpy(args);
      return {
        toUIMessageStreamResponse: () =>
          new Response("ok", { status: 200 }),
      };
    },
  };
});

import { POST } from "@/app/api/chat/route";

function makeRequest(body: unknown): Request {
  return new Request("http://test/api/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
  });
}

describe("POST /api/chat — orphan tool parts", () => {
  beforeEach(() => {
    streamTextSpy.mockClear();
    mocks.logUnanswered.mockClear();
  });

  it("does not throw when an assistant message contains an input-available tool part", async () => {
    const messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "I want to pay" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "text", text: "Sure, opening checkout." },
          {
            type: "tool-initiatePayment",
            state: "input-available",
            toolCallId: "call_orphan_1",
            input: { sessionId: "s_test" },
          },
        ],
      },
      { id: "u2", role: "user", parts: [{ type: "text", text: "Actually, hold on" }] },
    ];

    const res = await POST(makeRequest({ messages, sessionId: "s_test" }));
    expect(res.status).toBe(200);
    expect(streamTextSpy).toHaveBeenCalledTimes(1);
  });

  it("does not throw when a tool part is in input-streaming state", async () => {
    const messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Schedule me" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-scheduleAppointment",
            state: "input-streaming",
            toolCallId: "call_orphan_2",
            input: undefined,
          },
        ],
      },
      { id: "u2", role: "user", parts: [{ type: "text", text: "Never mind" }] },
    ];

    const res = await POST(makeRequest({ messages, sessionId: "s_test" }));
    expect(res.status).toBe(200);
    expect(streamTextSpy).toHaveBeenCalledTimes(1);
  });

  it("filters orphan tool parts out of the converted ModelMessages", async () => {
    const messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "I want to pay" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "text", text: "Opening checkout." },
          {
            type: "tool-initiatePayment",
            state: "input-available",
            toolCallId: "call_orphan_3",
            input: { sessionId: "s_test" },
          },
        ],
      },
      { id: "u2", role: "user", parts: [{ type: "text", text: "Hold on" }] },
    ];

    await POST(makeRequest({ messages, sessionId: "s_test" }));

    const passed = streamTextSpy.mock.calls[0][0] as {
      messages: Array<{ role: string; content: unknown }>;
    };

    // The orphan tool-call must not appear in the converted ModelMessages.
    // Without ignoreIncompleteToolCalls, convertToModelMessages would emit
    // a tool-call ModelMessage with toolCallId "call_orphan_3" and no paired
    // tool-result, which makes streamText's downstream prompt validator throw
    // AI_MissingToolResultsError.
    const allContent = JSON.stringify(passed.messages);
    expect(allContent).not.toContain("call_orphan_3");
  });

  it("preserves resolved tool parts (output-available) in the conversion", async () => {
    const messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "I want to pay" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-initiatePayment",
            state: "output-available",
            toolCallId: "call_resolved_1",
            input: { sessionId: "s_test" },
            output: { status: "completed" },
          },
        ],
      },
    ];

    await POST(makeRequest({ messages, sessionId: "s_test" }));

    const passed = streamTextSpy.mock.calls[0][0] as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const allContent = JSON.stringify(passed.messages);
    expect(allContent).toContain("call_resolved_1");
  });


  it("logs each repeated unmatched visitor question before streaming", async () => {
    const question = "Do you help with divorce property settlement?";

    await POST(
      makeRequest({
        sessionId: "s_repeat",
        messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: question }] }],
      }),
    );
    await POST(
      makeRequest({
        sessionId: "s_repeat",
        messages: [{ id: "u2", role: "user", parts: [{ type: "text", text: question }] }],
      }),
    );

    expect(mocks.logUnanswered).toHaveBeenCalledTimes(2);
    expect(mocks.logUnanswered).toHaveBeenNthCalledWith(1, question, "s_repeat");
    expect(mocks.logUnanswered).toHaveBeenNthCalledWith(2, question, "s_repeat");
  });

  it("does not log matched knowledge-base questions at the route level", async () => {
    await POST(
      makeRequest({
        sessionId: "s_match",
        messages: [
          { id: "u1", role: "user", parts: [{ type: "text", text: "Can I get bail?" }] },
        ],
      }),
    );

    expect(mocks.logUnanswered).not.toHaveBeenCalled();
  });
});
