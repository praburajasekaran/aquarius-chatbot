"use client";

import dynamic from "next/dynamic";

// ChatWidget reads localStorage in its useState initializer (and
// generates a session id with Date.now() + Math.random()), so SSR'ing
// it produces output that never matches the client and breaks
// hydration. Lazy-import with ssr: false so it only renders after
// mount.
export const ChatWidget = dynamic(
  () => import("./chat-widget").then((m) => m.ChatWidget),
  { ssr: false }
);
