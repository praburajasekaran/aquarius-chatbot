"use client";

import { ShieldAlert } from "lucide-react";

export function DisclaimerBanner() {
  return (
    <div className="bg-brand-light/20 border-b border-brand/20 px-4 py-2 text-xs text-gray-600">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-3.5 w-3.5 text-brand shrink-0" />
        <p>
          <strong>Disclaimer:</strong> This chatbot provides general information
          only. This is not legal advice. For advice specific to your situation,
          please book a Legal Strategy Session.{" "}
          <a href="#" className="text-brand underline">
            Privacy Policy
          </a>
        </p>
      </div>
    </div>
  );
}
