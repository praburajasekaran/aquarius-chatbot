// Cross-origin signalling between the chat iframe and the host-page launcher
// (public/embed.js). The launcher listens for messages tagged with
// `source: "aq-chat"` and ignores everything else. Keep these envelope types
// in sync with the message handler inside public/embed.js.

export type EmbedMessage = { source: "aq-chat"; type: "minimize" };

export function isEmbedded(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.parent !== window;
  } catch {
    return false;
  }
}

export function notifyParent(message: EmbedMessage): void {
  if (!isEmbedded()) return;
  try {
    window.parent.postMessage(message, "*");
  } catch {
    // postMessage can throw in exotic sandboxing scenarios; swallow.
  }
}
