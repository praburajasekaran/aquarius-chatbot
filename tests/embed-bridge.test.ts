// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isEmbedMessage, notifyParent, parentOrigin } from "@/lib/embed-bridge";

describe("embed bridge", () => {
  const originalParent = window.parent;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.NEXT_PUBLIC_EMBED_PARENT_ORIGINS =
      "https://www.aquariuscriminaldefence.com.au https://preview.example";
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: { postMessage: vi.fn() },
    });
    Object.defineProperty(document, "referrer", {
      configurable: true,
      value: "https://www.aquariuscriminaldefence.com.au/lp/criminal-law",
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: originalParent,
    });
    delete process.env.NEXT_PUBLIC_EMBED_PARENT_ORIGINS;
  });

  it("posts a typed message to the exact inferred parent origin", () => {
    const message = { source: "aq-chat", type: "payment_confirmed" } as const;

    notifyParent(message);

    expect(parentOrigin()).toBe("https://www.aquariuscriminaldefence.com.au");
    expect(window.parent.postMessage).toHaveBeenCalledWith(
      message,
      "https://www.aquariuscriminaldefence.com.au",
    );
  });

  it("rejects unknown types and payload-bearing envelopes", () => {
    expect(isEmbedMessage({ source: "aq-chat", type: "payment_confirmed", url: "/thank-you/" })).toBe(false);
    expect(isEmbedMessage({ source: "other", type: "appointment_booked" })).toBe(false);
    expect(isEmbedMessage({ source: "aq-chat", type: "appointment_booked" })).toBe(true);
  });

  it("does not post when the referrer is outside the configured allowlist", () => {
    Object.defineProperty(document, "referrer", {
      configurable: true,
      value: "https://evil.example/",
    });

    notifyParent({ source: "aq-chat", type: "appointment_booked" });

    expect(window.parent.postMessage).not.toHaveBeenCalled();
  });
});
