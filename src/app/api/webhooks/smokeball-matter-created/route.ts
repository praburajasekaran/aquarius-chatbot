import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { setMatterForSession } from "@/lib/session-matter-map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Capture-back endpoint for Zap #1's tail webhook step.
 *
 * After Zapier's "Smokeball: Create Matter" step runs, a "Webhooks by Zapier
 * → POST" step fires at this URL with the session↔matter binding:
 *
 *   POST /api/webhooks/smokeball-matter-created
 *   Headers: X-Smokeball-Capture-Secret: <SMOKEBALL_CAPTURE_SECRET>
 *   Body:    { "sessionId": "...", "smokeballMatterId": "..." }
 *
 * We store the mapping in Redis so later events for the same session (late
 * uploads, audit logs) can attach to the correct Smokeball matter without
 * round-tripping through Zapier to look it up.
 */

const PayloadSchema = z.object({
  sessionId: z.string().min(1),
  smokeballMatterId: z.string().min(1),
});

function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function POST(req: NextRequest) {
  const secret = process.env.SMOKEBALL_CAPTURE_SECRET;
  if (!secret) {
    console.error(
      "[smokeball-capture] SMOKEBALL_CAPTURE_SECRET not set — refusing request"
    );
    return NextResponse.json(
      { error: "not_configured" },
      { status: 500 }
    );
  }

  const header = req.headers.get("x-smokeball-capture-secret");
  if (!header || !timingSafeEqualString(header, secret)) {
    console.warn("[smokeball-capture] rejected: bad or missing secret header");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = PayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const mapping = await setMatterForSession(
      parsed.data.sessionId,
      parsed.data.smokeballMatterId
    );
    console.log("[smokeball-capture] mapped", {
      sessionId: parsed.data.sessionId,
      smokeballMatterId: parsed.data.smokeballMatterId,
    });
    return NextResponse.json({
      ok: true,
      capturedAt: mapping.capturedAt,
    });
  } catch (err) {
    console.error("[smokeball-capture] redis write failed", err);
    // Return 5xx so Zapier retries — transient Redis hiccup shouldn't lose
    // the mapping permanently.
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
