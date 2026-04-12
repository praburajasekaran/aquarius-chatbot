"use client";

import { Phone, Clock } from "lucide-react";
import { useSyncExternalStore } from "react";
import { FIRM_CONTACT, isInsideBusinessHours } from "@/lib/contact";

interface UrgentContactCardProps {
  onAcknowledge: () => void;
  disabled?: boolean;
}

const noopSubscribe = () => () => {};

export function UrgentContactCard({ onAcknowledge, disabled = false }: UrgentContactCardProps) {
  const insideHours = useSyncExternalStore<boolean | null>(
    noopSubscribe,
    () => isInsideBusinessHours(),
    () => null,
  );

  return (
    <div
      role="region"
      aria-label="Call us for urgent matters"
      className="mx-11 p-4 rounded-2xl border border-brand/40 bg-brand/5"
    >
      <h3 className="text-lg font-semibold text-gray-900 mb-2">
        Call us for urgent matters
      </h3>

      <a
        href={FIRM_CONTACT.phoneHref}
        className="flex items-center gap-2 text-2xl font-bold text-[#085a66] hover:underline"
      >
        <Phone className="h-6 w-6" aria-hidden="true" />
        {FIRM_CONTACT.phone}
      </a>

      <div className="mt-2 flex items-center gap-2 text-sm text-gray-700">
        <Clock className="h-4 w-4" aria-hidden="true" />
        <span>{FIRM_CONTACT.businessHours}</span>
      </div>

      {insideHours === false && (
        <p className="mt-3 text-sm text-gray-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
          We&apos;re outside business hours right now. Please call when we&apos;re open.
          For after-hours emergencies, leave a voicemail and we&apos;ll return your call first thing.
        </p>
      )}

      <button
        type="button"
        onClick={onAcknowledge}
        disabled={disabled}
        className="mt-4 px-4 min-h-[44px] rounded-full border border-[#085a66] text-[#085a66] hover:bg-[#085a66] hover:text-white transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      >
        I&apos;ve called
      </button>
    </div>
  );
}
