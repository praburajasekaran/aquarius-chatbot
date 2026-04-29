"use client";

import { useEffect, useState } from "react";
import { MessageCircle, X } from "lucide-react";

// Once-per-session sessionStorage key. Scoped to the embedding origin, so
// dismissals on one host site don't carry over to another. Wrapped in
// try/catch on every read/write because Safari private mode can throw.
const TEASER_FLAG_KEY = "aq_teaser_shown";
const TEASER_DELAY_MS = 3000;

export function ChatWidgetEmbed({ src = "/" }: { src?: string }) {
  const [open, setOpen] = useState(false);
  const [teaserVisible, setTeaserVisible] = useState(false);

  useEffect(() => {
    let alreadyShown = false;
    try {
      alreadyShown = sessionStorage.getItem(TEASER_FLAG_KEY) === "1";
    } catch {
      // Storage unavailable — fall through and show the teaser anyway.
    }
    if (alreadyShown) return;

    const id = setTimeout(() => setTeaserVisible(true), TEASER_DELAY_MS);
    return () => clearTimeout(id);
  }, []);

  function dismissTeaser() {
    setTeaserVisible(false);
    try {
      sessionStorage.setItem(TEASER_FLAG_KEY, "1");
    } catch {
      // Silent failure — worst case the teaser shows again next visit.
    }
  }

  function openChat() {
    setOpen(true);
    dismissTeaser();
  }

  if (typeof window === "undefined") return null;

  const teaserShown = teaserVisible && !open;

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

      {/* Teaser nudge — desktop only, once per session, hidden while chat is open. */}
      <div
        role="status"
        aria-live="polite"
        aria-hidden={!teaserShown}
        className={`hidden md:block fixed bottom-7 right-24 z-[9998] transition-all duration-300 motion-reduce:transition-none ${
          teaserShown
            ? "opacity-100 translate-y-0 pointer-events-auto"
            : "opacity-0 translate-y-1 pointer-events-none"
        }`}
      >
        <div className="relative">
          <button
            type="button"
            onClick={openChat}
            tabIndex={teaserShown ? 0 : -1}
            className="rounded-2xl bg-white ring-1 ring-black/5 shadow-[0_8px_24px_rgba(0,0,0,0.12)] pl-4 pr-9 py-3 text-sm text-gray-800 hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/40"
          >
            Need legal help? Ask me anything <span aria-hidden>→</span>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              dismissTeaser();
            }}
            tabIndex={teaserShown ? 0 : -1}
            aria-label="Dismiss chat teaser"
            className="absolute top-1.5 right-1.5 h-6 w-6 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openChat())}
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
