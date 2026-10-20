// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ChatWidgetEmbed } from "@/app/demo/chat-widget-embed";

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  delete (window as Window & { dataLayer?: unknown[] }).dataLayer;
});

it("forwards trusted starts for each conversation through the React launcher", () => {
  sessionStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const dataLayer: unknown[] = [];
  (window as Window & { dataLayer?: unknown[] }).dataLayer = dataLayer;
  render(<ChatWidgetEmbed src="https://chat.example/" />);
  const frame = screen.getByTitle("Aquarius Lawyers chat assistant") as HTMLIFrameElement;
  const data = { source: "aq-chat", type: "chat_started" };
  window.dispatchEvent(new MessageEvent("message", {
    origin: "https://evil.example", source: frame.contentWindow, data,
  }));
  expect(dataLayer).toEqual([]);
  for (let conversation = 0; conversation < 2; conversation++) {
    window.dispatchEvent(new MessageEvent("message", {
      origin: "https://chat.example", source: frame.contentWindow, data,
    }));
  }
  expect(dataLayer).toEqual([{ event: "chat_started" }, { event: "chat_started" }]);
});
