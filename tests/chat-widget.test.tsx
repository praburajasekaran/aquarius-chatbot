// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Mock MessageList to capture the props ChatWidget passes down.
// The asserted prop surface is failureReason + onPaymentComplete + onRetryRequested.
const messageListSpy = vi.fn();
const addToolOutputSpy = vi.fn();
const sendMessageSpy = vi.fn();
const setMessagesSpy = vi.fn();
let mockMessages: Array<Record<string, unknown>> = [];
vi.mock("@/components/chat/message-list", () => ({
  MessageList: (props: Record<string, unknown>) => {
    messageListSpy(props);
    return null;
  },
}));

// Mock DisclaimerBanner and MessageInput as no-ops so we can mount ChatWidget in isolation.
vi.mock("@/components/chat/disclaimer-banner", () => ({
  DisclaimerBanner: () => null,
}));
vi.mock("@/components/chat/message-input", () => ({
  MessageInput: () => null,
}));

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt="" {...props} />
  ),
}));

process.env.NEXT_PUBLIC_FIRM_NAME = "Aquarius Lawyers";

// Mock @ai-sdk/react useChat (the hook chat-widget consumes).
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: mockMessages,
    sendMessage: sendMessageSpy,
    addToolOutput: addToolOutputSpy,
    status: "ready",
    setMessages: setMessagesSpy,
    stop: vi.fn(),
  }),
}));

// Mock ai — chat-widget imports DefaultChatTransport + lastAssistantMessageIsCompleteWithToolCalls
vi.mock("ai", () => ({
  DefaultChatTransport: class {},
  lastAssistantMessageIsCompleteWithToolCalls: vi.fn(),
}));

// Helper: set window.location.search and reset history.replaceState spy
function setSearch(search: string) {
  const url = new URL(`http://localhost/${search}`);
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, search: url.search, pathname: "/", href: `http://localhost/${search}` },
  });
}

describe("ChatWidget URL signal", () => {
  let replaceStateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    messageListSpy.mockReset();
    addToolOutputSpy.mockReset();
    sendMessageSpy.mockReset();
    setMessagesSpy.mockReset();
    vi.stubGlobal("fetch", vi.fn());
    mockMessages = [
      {
        id: "assistant-payment",
        role: "assistant",
        parts: [{ type: "tool-initiatePayment", toolCallId: "pay-1" }],
      },
    ];
    replaceStateSpy = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
  });
  afterEach(() => {
    replaceStateSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("resolves the payment tool when ?payment=success", async () => {
    setSearch("?payment=success&paymentProof=proof_abcdefghijklmnopqrstuvwxyz123456");
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ confirmed: true }), { status: 200 }),
    );
    vi.resetModules();
    const { ChatWidget } = await import("@/components/chat/chat-widget");
    render(<ChatWidget />);
    await waitFor(() => {
      expect(setMessagesSpy).toHaveBeenCalled();
    });
    const nextMessages = setMessagesSpy.mock.calls[0][0] as Array<{
      parts: Array<Record<string, unknown>>;
    }>;
    expect(nextMessages[0].parts[0]).toMatchObject({
      type: "tool-initiatePayment",
      toolCallId: "pay-1",
      state: "output-available",
      output: { status: "completed" },
    });
    expect(nextMessages[1].parts[0]).toMatchObject({
      type: "tool-uploadDocuments",
    });
  });

  it("reports a server-proved payment to the embedding parent", async () => {
    const postMessage = vi.fn();
    const originalParent = window.parent;
    const originalReferrer = document.referrer;
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: { postMessage },
    });
    Object.defineProperty(document, "referrer", {
      configurable: true,
      value: "https://www.aquariuscriminaldefence.com.au/lp/criminal-law",
    });
    process.env.NEXT_PUBLIC_EMBED_PARENT_ORIGINS =
      "https://www.aquariuscriminaldefence.com.au";
    setSearch("?payment=success&paymentProof=proof_abcdefghijklmnopqrstuvwxyz123456");
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ confirmed: true }), { status: 200 }),
    );

    try {
      vi.resetModules();
      const { ChatWidget } = await import("@/components/chat/chat-widget");
      render(<ChatWidget />);
      await waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
      expect(postMessage).toHaveBeenCalledWith(
        { source: "aq-chat", type: "payment_confirmed" },
        "https://www.aquariuscriminaldefence.com.au",
      );
    } finally {
      Object.defineProperty(window, "parent", {
        configurable: true,
        value: originalParent,
      });
      Object.defineProperty(document, "referrer", {
        configurable: true,
        value: originalReferrer,
      });
      delete process.env.NEXT_PUBLIC_EMBED_PARENT_ORIGINS;
    }
  });

  it("does not resolve or emit a payment conversion for an unproved success query", async () => {
    setSearch("?payment=success");
    vi.resetModules();
    const { ChatWidget } = await import("@/components/chat/chat-widget");
    render(<ChatWidget />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(setMessagesSpy).not.toHaveBeenCalled();
  });

  it("reports failed payment return to the payment tool", async () => {
    setSearch("?payment=failed&reason=declined");
    vi.resetModules();
    const { ChatWidget } = await import("@/components/chat/chat-widget");
    render(<ChatWidget />);
    await waitFor(() => {
      expect(setMessagesSpy).toHaveBeenCalled();
    });
    const nextMessages = setMessagesSpy.mock.calls[0][0] as Array<{
      parts: Array<Record<string, unknown>>;
    }>;
    expect(nextMessages).toHaveLength(1);
    expect(nextMessages[0].parts[0]).toMatchObject({
      type: "tool-initiatePayment",
      toolCallId: "pay-1",
      state: "output-available",
      output: { status: "failed" },
    });
  });

  it("calls window.history.replaceState to clear the ?payment= param after handling", async () => {
    setSearch("?payment=success&paymentProof=proof_abcdefghijklmnopqrstuvwxyz123456");
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ confirmed: true }), { status: 200 }),
    );
    vi.resetModules();
    const { ChatWidget } = await import("@/components/chat/chat-widget");
    render(<ChatWidget />);
    await waitFor(() => expect(replaceStateSpy).toHaveBeenCalled());
  });

  it("does nothing when no ?payment= param is present", async () => {
    setSearch("");
    vi.resetModules();
    const { ChatWidget } = await import("@/components/chat/chat-widget");
    render(<ChatWidget />);
    expect(addToolOutputSpy).not.toHaveBeenCalled();
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it("retains the Aquarius Lawyers and Ask Banjo header with chat controls", async () => {
    setSearch("");
    mockMessages = [
      {
        id: "assistant-welcome",
        role: "assistant",
        parts: [{ type: "text", text: "Welcome" }],
      },
    ];
    vi.resetModules();
    const { ChatWidget } = await import("@/components/chat/chat-widget");
    render(<ChatWidget />);

    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Aquarius Lawyers" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ask Banjo", { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("presentation")).toHaveAttribute("src", "/banjo.png");
    expect(screen.getByRole("button", { name: "End chat" })).toBeInTheDocument();
  });

  it("appends Calendly scheduling directly when document upload resolves for a non-urgent intake", async () => {
    setSearch("");
    mockMessages = [
      {
        id: "assistant-upload",
        role: "assistant",
        parts: [
          {
            type: "tool-uploadDocuments",
            state: "input-available",
            toolCallId: "upload-1",
            input: { sessionId: "s_test" },
          },
        ],
      },
    ];
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          kind: "session-booking",
          sessionId: "s_test",
          prefillName: "Test Client",
          prefillEmail: "test@example.com",
          matterSummary: "Traffic matter",
        }),
        { status: 200 }
      )
    );

    vi.resetModules();
    const { ChatWidget } = await import("@/components/chat/chat-widget");
    render(<ChatWidget />);
    const latestProps = messageListSpy.mock.calls.at(-1)?.[0] as {
      onUploadComplete: (toolCallId: string, uploaded: number) => void;
    };

    latestProps.onUploadComplete("upload-1", 1);

    await waitFor(() => {
      expect(setMessagesSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: expect.stringMatching(/^post_upload_schedule_/),
            role: "assistant",
            parts: [
              expect.objectContaining({
                type: "tool-scheduleAppointment",
                state: "input-available",
                input: {
                  sessionId: "s_test",
                  prefillName: "Test Client",
                  prefillEmail: "test@example.com",
                  matterDescription: "Traffic matter",
                },
              }),
            ],
          }),
        ])
      );
    });
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it("uses the upload tool session for the post-upload booking lookup", async () => {
    setSearch("");
    localStorage.setItem(
      "aquarius_chat_v1",
      JSON.stringify({
        schemaVersion: 1,
        sessionId: "s_current",
        messages: [],
        expiresAt: Date.now() + 60_000,
      })
    );
    mockMessages = [
      {
        id: "assistant-upload",
        role: "assistant",
        parts: [
          {
            type: "tool-uploadDocuments",
            state: "input-available",
            toolCallId: "upload-1",
            input: { sessionId: "s_paid_intake" },
          },
        ],
      },
    ];
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          kind: "session-booking",
          sessionId: "s_paid_intake",
          prefillName: "Test Client",
          prefillEmail: "test@example.com",
        }),
        { status: 200 }
      )
    );

    vi.resetModules();
    const { ChatWidget } = await import("@/components/chat/chat-widget");
    render(<ChatWidget />);
    const latestProps = messageListSpy.mock.calls.at(-1)?.[0] as {
      onUploadComplete: (toolCallId: string, uploaded: number) => void;
    };

    latestProps.onUploadComplete("upload-1", 1);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/intake/s_paid_intake/next-step");
    });
  });

  it("reports a non-urgent booking once to the embedding parent", async () => {
    const postMessage = vi.fn();
    const originalParent = window.parent;
    const originalReferrer = document.referrer;
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: { postMessage },
    });
    Object.defineProperty(document, "referrer", {
      configurable: true,
      value: "https://www.aquariuscriminaldefence.com.au/lp/criminal-law",
    });
    process.env.NEXT_PUBLIC_EMBED_PARENT_ORIGINS =
      "https://www.aquariuscriminaldefence.com.au";
    setSearch("");
    mockMessages = [
      {
        id: "assistant-booking",
        role: "assistant",
        parts: [
          {
            type: "tool-selectUrgency",
            state: "output-available",
            output: { urgency: "non-urgent" },
          },
          {
            type: "tool-scheduleAppointment",
            state: "input-available",
            toolCallId: "book-1",
            input: { sessionId: "sess-1" },
          },
        ],
      },
    ];

    try {
      vi.resetModules();
      const { ChatWidget } = await import("@/components/chat/chat-widget");
      render(<ChatWidget />);
      const latestProps = messageListSpy.mock.calls.at(-1)?.[0] as {
        onScheduleBooked: (toolCallId: string, result: {
          eventStartTime: string;
          eventUri: string;
          inviteeUri: string;
        }) => void;
      };
      latestProps.onScheduleBooked("book-1", {
        eventStartTime: "2026-09-04T04:00:00Z",
        eventUri: "https://api.calendly.com/scheduled_events/event-1",
        inviteeUri: "https://api.calendly.com/scheduled_events/event-1/invitees/i-1",
      });
      latestProps.onScheduleBooked("book-1", {
        eventStartTime: "2026-09-04T04:00:00Z",
        eventUri: "https://api.calendly.com/scheduled_events/event-1",
        inviteeUri: "https://api.calendly.com/scheduled_events/event-1/invitees/i-1",
      });

      expect(postMessage).toHaveBeenCalledTimes(1);
      expect(postMessage).toHaveBeenCalledWith(
        { source: "aq-chat", type: "appointment_booked" },
        "https://www.aquariuscriminaldefence.com.au",
      );
    } finally {
      Object.defineProperty(window, "parent", {
        configurable: true,
        value: originalParent,
      });
      Object.defineProperty(document, "referrer", {
        configurable: true,
        value: originalReferrer,
      });
      delete process.env.NEXT_PUBLIC_EMBED_PARENT_ORIGINS;
    }
  });
});
