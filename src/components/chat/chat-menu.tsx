"use client";

import { useEffect, useRef, useState } from "react";
import { MoreVertical, RotateCcw } from "lucide-react";

interface ChatMenuProps {
  onEndChat: () => void;
  onOpen?: () => void;
}

export function ChatMenu({ onEndChat, onOpen }: ChatMenuProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      if (next) onOpen?.();
      return next;
    });
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label="Chat menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center justify-center h-8 w-8 rounded-full text-slate-600 hover:text-slate-900 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors"
      >
        <MoreVertical className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Chat actions"
          className="absolute right-0 top-full mt-1 z-30 min-w-[10rem] rounded-lg bg-white shadow-lg ring-1 ring-black/5 py-1"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onEndChat();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:bg-slate-100"
          >
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
            <span>End chat</span>
          </button>
        </div>
      )}
    </div>
  );
}
