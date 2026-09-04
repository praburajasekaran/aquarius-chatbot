import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createAuthKey,
  getBpointIframeUrl,
  getBpointRedirectBaseUrl,
} from "@/lib/bpoint";
import { PRICING } from "@/lib/pricing";
import { getIntake, updateIntake } from "@/lib/intake";
import { redis } from "@/lib/kv";
import { parseJsonBody } from "@/lib/api/parse";

const Body = z.object({
  sessionId: z.string().min(1),
  forceNew: z.boolean().optional(),
});
const AUTHKEY_CLAIM_TTL_SECONDS = 30 * 60;

function authKeyClaimKey(sessionId: string): string {
  return `bpoint-authkey:${sessionId}`;
}

function browserReturnUrlBase(req: Request): string | undefined {
  const origin = req.headers.get("origin");
  if (!origin) return undefined;
  try {
    const url = new URL(origin);
    const requestOrigin = new URL(req.url).origin;
    const configured = (process.env.CHATBOT_BROWSER_RETURN_ORIGINS ?? "")
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (url.origin === requestOrigin || configured.includes(url.origin)) {
      return url.origin;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function POST(req: Request) {
  const parsed = await parseJsonBody(req, Body);
  if (!parsed.ok) return parsed.response;
  const { sessionId, forceNew } = parsed.data;

  let intake;
  try {
    intake = await getIntake(sessionId);
  } catch (err) {
    console.error("[checkout] intake lookup failed", {
      event: "intake_lookup_failed",
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "intake_lookup_failed" }, { status: 502 });
  }
  if (!intake) {
    return NextResponse.json({ error: "intake_not_found" }, { status: 404 });
  }

  if (!PRICING[intake.urgency]) {
    return NextResponse.json({ error: "invalid_urgency" }, { status: 422 });
  }

  if (intake.bpointAuthKey && !forceNew) {
    return NextResponse.json({
      authKey: intake.bpointAuthKey,
      iframeUrl: getBpointIframeUrl(intake.bpointAuthKey),
    });
  }

  let authKey: string;
  try {
    const appUrl = getBpointRedirectBaseUrl();
    authKey = await createAuthKey({
      sessionId,
      urgency: intake.urgency,
      customerEmail: intake.clientEmail,
      redirectionUrlBase: appUrl,
      browserReturnUrlBase: browserReturnUrlBase(req),
      webhookUrlBase: appUrl,
    });

    const claimed = forceNew
      ? await redis.set(authKeyClaimKey(sessionId), authKey, {
          ex: AUTHKEY_CLAIM_TTL_SECONDS,
        })
      : await redis.set(authKeyClaimKey(sessionId), authKey, {
          nx: true,
          ex: AUTHKEY_CLAIM_TTL_SECONDS,
        });
    if (!forceNew && claimed !== "OK") {
      const existingAuthKey =
        (await redis.get<string>(authKeyClaimKey(sessionId))) ??
        (await getIntake(sessionId))?.bpointAuthKey;
      if (existingAuthKey) {
        return NextResponse.json({
          authKey: existingAuthKey,
          iframeUrl: getBpointIframeUrl(existingAuthKey),
        });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[checkout] BPoint AuthKey creation failed", {
      event: "checkout_create_failed",
      sessionId,
      err: message,
    });
    return NextResponse.json(
      {
        error: message.includes("redirect base URL")
          ? "bpoint_redirect_url_invalid"
          : "checkout_create_failed",
      },
      { status: 502 }
    );
  }

  try {
    await updateIntake(sessionId, { bpointAuthKey: authKey });
  } catch (err) {
    console.error("[checkout] failed to persist bpointAuthKey to intake", err);
  }

  return NextResponse.json({ authKey, iframeUrl: getBpointIframeUrl(authKey) });
}
