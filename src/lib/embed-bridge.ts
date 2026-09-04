// Cross-origin signalling between the chat iframe and the host-page launcher
// (public/embed.js). Keep this deliberately small: the host only needs to
// know that a conversion milestone happened, never anything from the intake.

export type EmbedMessage =
  | { source: "aq-chat"; type: "minimize" }
  | { source: "aq-chat"; type: "payment_confirmed" }
  | { source: "aq-chat"; type: "appointment_booked" };

const EMBED_SOURCE = "aq-chat" as const;
const ALLOWED_MESSAGE_TYPES = new Set<EmbedMessage["type"]>([
  "minimize",
  "payment_confirmed",
  "appointment_booked",
]);

function configuredParentOrigins(): string[] {
  return (process.env.NEXT_PUBLIC_EMBED_PARENT_ORIGINS ?? "")
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter((value) => {
      try {
        return new URL(value).origin === value;
      } catch {
        return false;
      }
    });
}

function inferredParentOrigin(): string | null {
  if (typeof document === "undefined") return null;

  try {
    const referrer = document.referrer.trim();
    if (referrer) return new URL(referrer).origin;
  } catch {
    // A malformed referrer is treated as unavailable.
  }

  try {
    const ancestorOrigins = (document.location as Document["location"] & {
      ancestorOrigins?: DOMStringList;
    }).ancestorOrigins;
    const first = ancestorOrigins?.[0];
    if (first) return new URL(first).origin;
  } catch {
    // ancestorOrigins is not available in every browser.
  }

  return null;
}

/**
 * Resolve the one origin to which the child may post. A configured origin is
 * required in production; the referrer fallback keeps local/demo embeds
 * usable while still avoiding the insecure `"*"` target.
 */
export function parentOrigin(): string | null {
  const configured = configuredParentOrigins();
  const inferred = inferredParentOrigin();

  // A production deployment must opt into its parent origins explicitly. In
  // development/test we can safely infer the embedding origin for local and
  // demo surfaces, but a missing production variable should fail closed.
  if (configured.length === 0 && process.env.NODE_ENV === "production") {
    return null;
  }

  if (inferred && (configured.length === 0 || configured.includes(inferred))) {
    return inferred;
  }
  if (configured.length === 1) return configured[0];
  return null;
}

export function isEmbedMessage(value: unknown): value is EmbedMessage {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  const keys = Object.keys(data);
  return (
    keys.length === 2 &&
    keys.includes("source") &&
    keys.includes("type") &&
    data.source === EMBED_SOURCE &&
    typeof data.type === "string" &&
    ALLOWED_MESSAGE_TYPES.has(data.type as EmbedMessage["type"])
  );
}

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
  const origin = parentOrigin();
  if (!origin || !isEmbedMessage(message)) return;
  try {
    window.parent.postMessage(message, origin);
  } catch {
    // postMessage can throw in exotic sandboxing scenarios; swallow.
  }
}
