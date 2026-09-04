"use client";

import { useEffect, useRef, useState } from "react";
import { InlineWidget } from "react-calendly";
import { CheckCircle2 } from "lucide-react";

interface CalendlyEmbedProps {
  sessionId: string;
  prefillName: string;
  prefillEmail: string;
  matterDescription: string;
  onBooked: (result: {
    eventStartTime: string;
    eventUri: string;
    inviteeUri: string;
  }) => void;
  disabled?: boolean;
}

interface CalendlyScheduledPayload {
  event?: { uri?: string; start_time?: string };
  invitee?: { uri?: string };
}

interface CalendlyPostMessageData {
  event?: string;
  payload?: CalendlyScheduledPayload;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isCalendlyEvent(data: unknown): data is CalendlyPostMessageData {
  if (!isPlainObject(data)) return false;
  if (Object.keys(data).some((key) => key !== "event" && key !== "payload")) {
    return false;
  }
  const d = data as { event?: unknown; payload?: unknown };
  if (d.event !== "calendly.event_scheduled" || !isPlainObject(d.payload)) {
    return false;
  }

  const payload = d.payload as {
    event?: { uri?: unknown };
    invitee?: { uri?: unknown };
  };
  return (
    isPlainObject(payload.event) &&
    typeof payload.event.uri === "string" &&
    payload.event.uri.length > 0 &&
    isPlainObject(payload.invitee) &&
    typeof payload.invitee.uri === "string" &&
    payload.invitee.uri.length > 0
  );
}

export function CalendlyEmbed({
  sessionId,
  prefillName,
  prefillEmail,
  matterDescription,
  onBooked,
  disabled = false,
}: CalendlyEmbedProps) {
  const [booked, setBooked] = useState<{
    eventStartTime: string;
    eventUri: string;
  } | null>(null);
  const firedRef = useRef(false);
  const embedContainerRef = useRef<HTMLDivElement>(null);
  const url = process.env.NEXT_PUBLIC_CALENDLY_BOOKING_URL;

  useEffect(() => {
    if (!url) return;

    const allowedOrigins = new Set<string>();
    const configuredOrigins = (process.env.NEXT_PUBLIC_CALENDLY_ALLOWED_ORIGINS ?? "")
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    configuredOrigins.forEach((origin) => {
      try {
        allowedOrigins.add(new URL(origin).origin);
      } catch {
        // Ignore malformed deployment configuration.
      }
    });
    try {
      allowedOrigins.add(new URL(url).origin);
    } catch {
      return;
    }

    function handler(e: MessageEvent) {
      if (!isCalendlyEvent(e.data)) return;
      if (firedRef.current || disabled) return;
      if (!allowedOrigins.has(e.origin)) return;

      const iframe = embedContainerRef.current?.querySelector("iframe");
      if (!iframe || e.source !== iframe.contentWindow) return;

      const payload = e.data.payload;
      if (!payload) return;
      const eventUri = payload.event?.uri ?? "";
      const inviteeUri = payload.invitee?.uri ?? "";
      const eventStartTime = payload.event?.start_time ?? "";

      firedRef.current = true;
      setBooked({ eventStartTime, eventUri });
      onBooked({ eventStartTime, eventUri, inviteeUri });
    }

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onBooked, disabled, url]);

  if (!url) {
    return (
      <div
        role="alert"
        className="mx-11 p-4 rounded-2xl border border-amber-200 bg-amber-50 text-sm text-amber-900"
      >
        Booking is temporarily unavailable. Please contact us directly.
      </div>
    );
  }

  if (booked) {
    return (
      <div
        role="status"
        className="mx-11 p-4 rounded-2xl border border-green-200 bg-green-50 flex items-start gap-3"
      >
        <CheckCircle2 className="h-5 w-5 text-green-700 shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <p className="font-semibold text-green-900">Your session is confirmed.</p>
          <p className="text-sm text-green-800 mt-1">
            Calendly will email you a calendar invite and confirmation shortly.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={embedContainerRef}
      className="-mx-4 rounded-2xl overflow-hidden border border-brand/30"
    >
      <InlineWidget
        url={url}
        prefill={{
          name: prefillName,
          email: prefillEmail,
          customAnswers: { a1: matterDescription },
        }}
        utm={{ utmContent: sessionId }}
        styles={{ height: "650px", minWidth: "0" }}
      />
    </div>
  );
}
