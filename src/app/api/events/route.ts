import { NextResponse } from "next/server";
import { track } from "@vercel/analytics/server";

// Allowed event names. Anything else is rejected so a misbehaving (or
// malicious) embed.js consumer can't pollute the analytics dashboard with
// arbitrary event names. Add to this list when introducing new events.
const ALLOWED_EVENTS = new Set([
  "teaser_shown",
  "teaser_clicked",
  "teaser_dismissed",
  "chat_opened",
  "chat_closed",
]);

// Open CORS for now — the embed.js script is meant to load on arbitrary
// third-party sites. Tighten via an env-driven allowlist if/when the set of
// embedding hosts is known.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
} as const;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const { event, properties } = (body ?? {}) as {
    event?: string;
    properties?: Record<string, string | number | boolean>;
  };

  if (!event || !ALLOWED_EVENTS.has(event)) {
    return NextResponse.json(
      { error: "Unknown event" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // Strip any keys that could leak PII from the embedding host.
  // Only allow a known-safe set of properties forward.
  const safeProps: Record<string, string | number | boolean> = {
    surface: "embed",
    host: req.headers.get("origin") ?? "unknown",
  };
  if (properties) {
    if (typeof properties.source === "string") safeProps.source = properties.source;
    if (typeof properties.reduced_motion === "boolean")
      safeProps.reduced_motion = properties.reduced_motion;
  }

  await track(event, safeProps);

  return NextResponse.json(
    { ok: true },
    { status: 200, headers: CORS_HEADERS },
  );
}
