// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

// Mock MessageList to capture the props ChatWidget passes down.
// The asserted prop surface is failureReason + onPaymentComplete + onRetryRequested.
const messageListSpy = vi.fn();
const addToolOutputSpy = vi.fn();
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
    sendMessage: vi.fn(),
    addToolOutput: addToolOutputSpy,
    status: "ready",
    setMessages: vi.fn(),
    stop: vi.fn(),
  }),
}));

// Mock ai — chat-widget imports DefaultChatTransport + lastAssistantMessageIsCompleteWithToolCalls
vi.mock("ai", () => ({
  DefaultChatTransport: class {
    constructor(_opts: unknown) {}
  },
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
    vi.clearAllMocks();
  });

  it("calls handlePaymentComplete (via onPaymentComplete) when ?payment=success", async () => {
    setSearch("?payment=success");
    vi.resetModules();
    const { ChatWidget } = await import("@/components/chat/chat-widget");
    render(<ChatWidget />);
    await waitFor(() => {
      expect(addToolOutputSpy).toHaveBeenCalledWith({
        tool: "initiatePayment",
        toolCallId: "pay-1",
        output: { status: "completed" },
      });
    });
  });

  it("reports failed payment return to the payment tool", async () => {
    setSearch("?payment=failed&reason=declined");
    vi.resetModules();
    const { ChatWidget } = await import("@/components/chat/chat-widget");
    render(<ChatWidget />);
    await waitFor(() => {
      expect(addToolOutputSpy).toHaveBeenCalledWith({
        tool: "initiatePayment",
        toolCallId: "pay-1",
        output: { status: "failed" },
      });
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
});
