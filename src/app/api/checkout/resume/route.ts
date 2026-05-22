import { NextResponse, type NextRequest } from "next/server";
import { createAuthKey, getBpointRedirectBaseUrl } from "@/lib/bpoint";
import { getIntake, updateIntake } from "@/lib/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SESSION_ID_LENGTH = 200;

function fallbackAppUrl(req: NextRequest): string {
  const raw = process.env.NEXT_PUBLIC_URL ?? process.env.APP_URL;
  if (!raw) return req.nextUrl.origin;
  try {
    return new URL(raw).origin;
  } catch {
    return req.nextUrl.origin;
  }
}

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session");
  const fallbackUrl = fallbackAppUrl(req);

  if (
    !sessionId ||
    sessionId.length === 0 ||
    sessionId.length > MAX_SESSION_ID_LENGTH
  ) {
    return NextResponse.redirect(`${fallbackUrl}/?expired=1`);
  }

  let intake;
  try {
    intake = await getIntake(sessionId);
  } catch (err) {
    console.error("[checkout/resume] intake lookup failed", {
      event: "intake_lookup_failed",
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.redirect(`${fallbackUrl}/?expired=1`);
  }
  if (!intake) {
    return NextResponse.redirect(`${fallbackUrl}/?expired=1`);
  }

  let authKey: string;
  try {
    const appUrl = getBpointRedirectBaseUrl();
    authKey = await createAuthKey({
      sessionId: intake.sessionId,
      urgency: intake.urgency,
      customerEmail: intake.clientEmail,
      redirectionUrlBase: appUrl,
      webhookUrlBase: appUrl,
    });
  } catch (err) {
    console.error("[checkout/resume] BPoint AuthKey creation failed", {
      event: "bpoint_authkey_create_failed",
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.redirect(`${fallbackUrl}/?expired=1`);
  }

  try {
    await updateIntake(sessionId, { bpointAuthKey: authKey });
  } catch (err) {
    console.error("[checkout/resume] updateIntake failed", {
      event: "intake_update_failed",
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.redirect(
    `https://www.bpoint.com.au/webapi/v2/txns/iframe/${encodeURIComponent(authKey)}`
  );
}
