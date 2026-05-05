"use client";

import { useEffect, useState } from "react";
import { MessageCircle, Minus } from "lucide-react";
import { track } from "@vercel/analytics";

// Mirror of public/embed.js — keep both surfaces in lockstep when changing
// widget UX (state machine, default-open behaviour, mobile reset, postMessage
// envelope).

const STATE_KEY = "aq_widget_state"; // 'open' | 'minimized'
const TEASER_FLAG_KEY = "aq_teaser_shown";
const TEASER_DELAY_MS = 3000;
const DESKTOP_QUERY = "(min-width: 768px)";

function readState(): "open" | "minimized" | null {
  try {
    const v = sessionStorage.getItem(STATE_KEY);
    return v === "open" || v === "minimized" ? v : null;
  } catch {
    return null;
  }
}
function writeState(s: "open" | "minimized") {
  try {
    sessionStorage.setItem(STATE_KEY, s);
  } catch {
    // noop
  }
}

function computeInitialState(): "open" | "minimized" {
  if (typeof window === "undefined") return "minimized";
  let isDesktop = false;
  try {
    isDesktop = window.matchMedia(DESKTOP_QUERY).matches;
  } catch {
    // noop
  }
  if (!isDesktop) return "minimized";
  const stored = readState();
  if (stored === "minimized") return "minimized";
  return "open";
}

export function ChatWidgetEmbed({ src = "/" }: { src?: string }) {
  const [state, setState] = useState<"open" | "minimized">(computeInitialState);
  const [teaserVisible, setTeaserVisible] = useState(false);

  // Persist state changes + emit auto-open analytics on first paint.
  useEffect(() => {
    const stored = readState();
    if (state === "open" && !stored) {
      writeState("open");
      track("chat_opened", { surface: "react", source: "auto" });
    } else if (stored !== state) {
      writeState(state);
    }
    // Mount-only — subsequent state changes flow through openChat/minimizeChat
    // which call writeState directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Teaser only fires when boot state is 'minimized' (mobile, or desktop
  // visitor who explicitly minimised earlier in this tab).
  useEffect(() => {
    if (state !== "minimized") return;
    let alreadyShown = false;
    try {
      alreadyShown = sessionStorage.getItem(TEASER_FLAG_KEY) === "1";
    } catch {
      // noop
    }
    if (alreadyShown) return;

    const id = setTimeout(() => {
      setTeaserVisible(true);
      track("teaser_shown", { surface: "react" });
    }, TEASER_DELAY_MS);
    return () => clearTimeout(id);
  }, [state]);

  function dismissTeaser() {
    setTeaserVisible(false);
    try {
      sessionStorage.setItem(TEASER_FLAG_KEY, "1");
    } catch {
      // noop
    }
  }

  function openChat(source: "teaser" | "launcher") {
    writeState("open");
    setState("open");
    dismissTeaser();
    if (source === "teaser") track("teaser_clicked", { surface: "react" });
    track("chat_opened", { surface: "react", source });
  }

  function minimizeChat(source: "panel" | "launcher") {
    writeState("minimized");
    setState("minimized");
    track("chat_minimized", { surface: "react", source });
  }

  // Listen for the iframe's Minimize button via postMessage.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const data = e.data as { source?: string; type?: string } | null;
      if (!data || data.source !== "aq-chat") return;
      if (data.type === "minimize") minimizeChat("panel");
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (typeof window === "undefined") return null;

  const open = state === "open";
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
            onClick={() => openChat("teaser")}
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
              track("teaser_dismissed", { surface: "react" });
            }}
            tabIndex={teaserShown ? 0 : -1}
            aria-label="Dismiss chat teaser"
            className="absolute top-1.5 right-1.5 h-6 w-6 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <span aria-hidden className="text-sm leading-none">×</span>
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => (open ? minimizeChat("launcher") : openChat("launcher"))}
        aria-label={open ? "Minimize chat" : "Open chat"}
        aria-expanded={open}
        className="fixed bottom-5 right-5 z-[9999] h-14 w-14 rounded-full bg-brand text-white flex items-center justify-center shadow-[0_8px_24px_rgba(97,187,202,0.5)] hover:scale-105 hover:bg-brand-dark transition-all focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/40"
      >
        {open ? (
          <Minus className="h-6 w-6" strokeWidth={2.5} />
        ) : (
          <MessageCircle className="h-6 w-6" strokeWidth={2.25} />
        )}
      </button>
    </>
  );
}
