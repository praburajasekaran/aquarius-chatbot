// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Home from "@/app/page";

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt="" {...props} />
  ),
}));

vi.mock("@/components/chat/chat-widget-client", () => ({
  // The real ChatWidget header is covered in chat-widget.test.tsx. Keep this
  // page-shell test focused on removing the outer identity row.
  ChatWidget: () => <div data-testid="chat-widget" aria-label="Ask Banjo chat" />,
}));

async function renderHome(searchParams: { expired?: string; paid?: string } = {}) {
  const page = await Home({ searchParams: Promise.resolve(searchParams) });
  return render(page);
}

describe("home page identity", () => {
  it("removes the redundant identifier while preserving the main chat region", async () => {
    await renderHome();

    expect(screen.queryByText("Criminal Law Assistant")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(
      screen.getByRole("link", { name: "Skip to main content" }),
    ).toHaveAttribute("href", "#main-content");
    expect(screen.getByTestId("chat-widget")).toBeInTheDocument();
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  });

  it("keeps expired and paid status messages after the header cleanup", async () => {
    await renderHome({ expired: "1", paid: "1" });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your previous session has expired.",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Payment already complete",
    );
  });
});
