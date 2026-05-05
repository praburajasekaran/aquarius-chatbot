"use client";

import { RotateCcw } from "lucide-react";

interface EndChatButtonProps {
  onClick: () => void;
}

export function EndChatButton({ onClick }: EndChatButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="End chat"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full text-slate-600 hover:text-slate-900 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors"
    >
      <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
      <span>End chat</span>
    </button>
  );
}
