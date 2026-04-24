import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaymentCard } from "@/components/payment/payment-card";

describe("PaymentCard", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ authKey: "AK-1234" }),
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders an iframe with the BPoint iframe URL when authKey resolves", async () => {
    render(
      <PaymentCard
        sessionId="s1"
        urgency="urgent"
        displayPrice="$1,320"
        onComplete={() => {}}
      />
    );
    await waitFor(() => {
      const iframe = screen.getByTitle(/secure card payment/i) as HTMLIFrameElement;
      expect(iframe.src).toBe("https://www.bpoint.com.au/webapi/v2/txns/iframe/AK-1234");
    });
  });

  it("does NOT render Stripe EmbeddedCheckoutProvider", async () => {
    const { container } = render(
      <PaymentCard
        sessionId="s1"
        urgency="urgent"
        displayPrice="$1,320"
        onComplete={() => {}}
      />
    );
    // EmbeddedCheckoutProvider would render a div with stripe-related class; verify absent
    expect(container.innerHTML).not.toMatch(/EmbeddedCheckout/i);
  });

  it("renders the expiry UI when failureReason='expired'", async () => {
    render(
      <PaymentCard
        sessionId="s1"
        urgency="urgent"
        displayPrice="$1,320"
        failureReason="expired"
        onComplete={() => {}}
      />
    );
    expect(await screen.findByText(/payment session expired/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start again/i })).toBeInTheDocument();
  });

  it("clicking 'Start again' refetches /api/checkout", async () => {
    render(
      <PaymentCard
        sessionId="s1"
        urgency="urgent"
        displayPrice="$1,320"
        failureReason="expired"
        onComplete={() => {}}
      />
    );
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const initialCalls = fetchMock.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: /start again/i }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(initialCalls));
  });
});
