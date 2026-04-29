"use client";

import { useState } from "react";
import { MessageCircle, X } from "lucide-react";

export function ChatWidgetEmbed({ src = "/" }: { src?: string }) {
  const [open, setOpen] = useState(false);

  if (typeof window === "undefined") return null;

  return (
    <>
      <div
        className={`fixed bottom-24 right-5 z-[9998] transition-all duration-200 ${
          open
            ? "opacity-100 translate-y-0 pointer-events-auto"
            : "opacity-0 translate-y-2 pointer-events-none"
        }`}
        aria-hidden={!open}
      >
        <div className="w-[min(400px,calc(100vw-2.5rem))] h-[min(620px,calc(100vh-8rem))] rounded-2xl overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.25)] bg-white ring-1 ring-black/5">
          {open && (
            <iframe
              src={src}
              title="Aquarius Lawyers chat assistant"
              className="w-full h-full border-0"
              allow="clipboard-write"
            />
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close chat" : "Open chat"}
        aria-expanded={open}
        className="fixed bottom-5 right-5 z-[9999] h-14 w-14 rounded-full bg-brand text-white flex items-center justify-center shadow-[0_8px_24px_rgba(97,187,202,0.5)] hover:scale-105 hover:bg-brand-dark transition-all focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/40"
      >
        {open ? (
          <X className="h-6 w-6" strokeWidth={2.5} />
        ) : (
          <MessageCircle className="h-6 w-6" strokeWidth={2.25} />
        )}
      </button>
    </>
  );
}
