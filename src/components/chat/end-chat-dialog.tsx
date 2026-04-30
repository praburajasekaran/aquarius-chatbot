"use client";

import { useEffect, useRef } from "react";

interface EndChatDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function EndChatDialog({ open, onConfirm, onCancel }: EndChatDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  // Focus the destructive action when the dialog opens, and trap Esc.
  useEffect(() => {
    if (!open) return;
    confirmButtonRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onCancel}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="end-chat-dialog-title"
        aria-describedby="end-chat-dialog-desc"
        className="bg-white rounded-xl shadow-xl mx-4 max-w-xs w-full p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="end-chat-dialog-title"
          className="text-base font-semibold text-slate-900 mb-2"
        >
          End this chat?
        </h2>
        <p
          id="end-chat-dialog-desc"
          className="text-sm text-slate-600 mb-5"
        >
          Your conversation will be cleared from this device.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded-md text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
          >
            Cancel
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={onConfirm}
            className="px-3 py-1.5 text-sm rounded-md bg-brand text-white hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            End chat
          </button>
        </div>
      </div>
    </div>
  );
}
