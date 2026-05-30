// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

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
    setSearch("?payment=success");
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
    setSearch("?payment=success");
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
});
