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
      title="End chat"
      className="absolute top-2 right-2 z-10 inline-flex items-center justify-center h-8 w-8 rounded-full text-slate-500 hover:text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors"
    >
      <RotateCcw className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
    </button>
  );
}
