// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PaymentCard } from "@/components/payment/payment-card";

describe("PaymentCard", () => {
  beforeEach(() => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/pricing")) {
        return {
          ok: true,
          json: async () => ({
            urgency: "urgent",
            displayPrice: "$1,320",
            tier: "Urgent",
            lineItem: "Urgent legal strategy session",
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          authKey: "AK-1234",
          iframeUrl: "https://www.bpoint.com.au/webapi/v2/txns/iframe/AK-1234",
        }),
      } as Response;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders an iframe with the BPoint iframe URL when authKey resolves", async () => {
    render(
      <PaymentCard
        sessionId="s1"
        onComplete={() => {}}
      />
    );
    await waitFor(() => {
      const iframe = screen.getByTitle(/bpoint secure payment form/i) as HTMLIFrameElement;
      expect(iframe.src).toBe("https://www.bpoint.com.au/webapi/v2/txns/iframe/AK-1234");
    });
  });

  it("does NOT render Stripe EmbeddedCheckoutProvider", async () => {
    const { container } = render(
      <PaymentCard
        sessionId="s1"
        onComplete={() => {}}
      />
    );
    // EmbeddedCheckoutProvider would render a div with stripe-related class; verify absent
    expect(container.innerHTML).not.toMatch(/EmbeddedCheckout/i);
  });

  it("shows a not-ready message when the intake pricing record is missing", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/pricing")) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: "intake_not_found" }),
        } as Response;
      }
      throw new Error("checkout should not be called");
    });

    render(<PaymentCard sessionId="missing" onComplete={() => {}} />);

    await screen.findByText(
      "Payment is not ready yet. Please complete your contact details and choose an urgency option first."
    );
  });
});
