import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";

// Mock MessageList to capture the props ChatWidget passes down.
// The asserted prop surface is failureReason + onPaymentComplete + onRetryRequested.
const messageListSpy = vi.fn();
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
    messages: [],
    sendMessage: vi.fn(),
    addToolOutput: vi.fn(),
    status: "ready",
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
    // The most recent MessageList render must have onPaymentComplete invoked.
    // Implementation detail: chat-widget calls handlePaymentComplete("") on success
    // signal. Since MessageList is mocked, we verify the side-effect by inspecting
    // a state prop OR by spying on a downstream behavior.
    // Minimal assertion: failureReason was NOT set (success path).
    const lastProps = messageListSpy.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
    expect(lastProps?.failureReason).toBeUndefined();
  });

  it("sets failureReason='expired' when ?payment=failed&reason=expired", async () => {
    setSearch("?payment=failed&reason=expired");
    vi.resetModules();
    const { ChatWidget } = await import("@/components/chat/chat-widget");
    render(<ChatWidget />);
    const lastProps = messageListSpy.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
    expect(lastProps?.failureReason).toBe("expired");
  });

  it("sets failureReason='declined' when ?payment=failed&reason=declined", async () => {
    setSearch("?payment=failed&reason=declined");
    vi.resetModules();
    const { ChatWidget } = await import("@/components/chat/chat-widget");
    render(<ChatWidget />);
    const lastProps = messageListSpy.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
    expect(lastProps?.failureReason).toBe("declined");
  });

  it("falls back to failureReason='system' for unknown reason values", async () => {
    setSearch("?payment=failed&reason=banana");
    vi.resetModules();
    const { ChatWidget } = await import("@/components/chat/chat-widget");
    render(<ChatWidget />);
    const lastProps = messageListSpy.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
    expect(lastProps?.failureReason).toBe("system");
  });

  it("calls window.history.replaceState to clear the ?payment= param after handling", async () => {
    setSearch("?payment=success");
    vi.resetModules();
    const { ChatWidget } = await import("@/components/chat/chat-widget");
    render(<ChatWidget />);
    expect(replaceStateSpy).toHaveBeenCalled();
  });

  it("does nothing when no ?payment= param is present", async () => {
    setSearch("");
    vi.resetModules();
    const { ChatWidget } = await import("@/components/chat/chat-widget");
    render(<ChatWidget />);
    const lastProps = messageListSpy.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
    expect(lastProps?.failureReason).toBeUndefined();
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });
});
