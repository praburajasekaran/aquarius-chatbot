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
  event?: { uri?: string };
  invitee?: { uri?: string };
}

interface CalendlyPostMessageData {
  event?: string;
  payload?: CalendlyScheduledPayload;
}

function isCalendlyEvent(data: unknown): data is CalendlyPostMessageData {
  if (!data || typeof data !== "object") return false;
  const d = data as { event?: unknown };
  return typeof d.event === "string" && d.event.startsWith("calendly.");
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

  useEffect(() => {
    function handler(e: MessageEvent) {
      if (!isCalendlyEvent(e.data)) return;
      if (e.data.event !== "calendly.event_scheduled") return;
      if (firedRef.current || disabled) return;

      const payload = e.data.payload ?? {};
      const eventUri = payload.event?.uri ?? "";
      const inviteeUri = payload.invitee?.uri ?? "";
      const eventStartTime = "";

      firedRef.current = true;
      setBooked({ eventStartTime, eventUri });
      onBooked({ eventStartTime, eventUri, inviteeUri });
    }

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onBooked, disabled]);

  const url =
    process.env.NEXT_PUBLIC_CALENDLY_BOOKING_URL ??
    "https://calendly.com/ekalaivan/advising-meeting";

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
    <div className="mx-11 rounded-2xl overflow-hidden border border-brand/30">
      <InlineWidget
        url={url}
        prefill={{
          name: prefillName,
          email: prefillEmail,
          customAnswers: { a1: matterDescription },
        }}
        utm={{ utmContent: sessionId }}
        styles={{ height: "650px" }}
      />
    </div>
  );
}
