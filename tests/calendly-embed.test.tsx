// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("react-calendly", () => ({
  InlineWidget: () => (
    <iframe title="Calendly booking" src="https://calendly.com/aquarius/session" />
  ),
}));

import { CalendlyEmbed } from "@/components/booking/calendly-embed";

describe("CalendlyEmbed message boundary", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_CALENDLY_BOOKING_URL =
      "https://calendly.com/aquarius/session";
    delete process.env.NEXT_PUBLIC_CALENDLY_ALLOWED_ORIGINS;
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_CALENDLY_BOOKING_URL;
    vi.restoreAllMocks();
  });

  function renderEmbed() {
    const onBooked = vi.fn();
    render(
      <CalendlyEmbed
        sessionId="sess-1"
        prefillName="Test Client"
        prefillEmail="test@example.com"
        matterDescription="Traffic matter"
        onBooked={onBooked}
      />,
    );
    return {
      onBooked,
      iframe: screen.getByTitle("Calendly booking") as HTMLIFrameElement,
    };
  }

  function scheduledMessage(source: MessageEventSource | null = null) {
    return new MessageEvent("message", {
      origin: "https://calendly.com",
      source,
      data: {
        event: "calendly.event_scheduled",
        payload: {
          event: {
            uri: "https://api.calendly.com/scheduled_events/event-1",
            start_time: "2026-09-04T04:00:00Z",
          },
          invitee: {
            uri: "https://api.calendly.com/scheduled_events/event-1/invitees/i-1",
          },
        },
      },
    });
  }

  it("accepts a scheduled event only from the configured Calendly iframe", () => {
    const { onBooked, iframe } = renderEmbed();

    fireEvent(window, scheduledMessage(iframe.contentWindow));
    fireEvent(window, scheduledMessage(iframe.contentWindow));

    expect(onBooked).toHaveBeenCalledTimes(1);
    expect(onBooked).toHaveBeenCalledWith({
      eventStartTime: "2026-09-04T04:00:00Z",
      eventUri: "https://api.calendly.com/scheduled_events/event-1",
      inviteeUri: "https://api.calendly.com/scheduled_events/event-1/invitees/i-1",
    });
  });

  it("ignores wrong origins, wrong frames, and malformed payloads", () => {
    const { onBooked, iframe } = renderEmbed();
    const otherFrame = document.createElement("iframe");
    document.body.appendChild(otherFrame);

    fireEvent(
      window,
      new MessageEvent("message", {
        origin: "https://evil.example",
        source: iframe.contentWindow,
        data: scheduledMessage(iframe.contentWindow).data,
      }),
    );
    fireEvent(window, scheduledMessage(otherFrame.contentWindow));
    fireEvent(
      window,
      new MessageEvent("message", {
        origin: "https://calendly.com",
        source: iframe.contentWindow,
        data: { event: "calendly.event_scheduled", payload: { redirectUrl: "/thank-you/" } },
      }),
    );

    expect(onBooked).not.toHaveBeenCalled();
  });
});
