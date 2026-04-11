import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { z } from "zod";
import { verifyCookie, COOKIE_NAME } from "@/lib/upload-session";
import { tokenLimiter, globalLimiter } from "@/lib/rate-limit";
import { hashToken } from "@/lib/upload-tokens";
import { ALLOWED_CONTENT_TYPES, MAX_BYTES } from "@/lib/allowed-types";
import { handleUploadCompleted } from "@/lib/late-upload/handle-completed";

export const runtime = "nodejs";
export const maxDuration = 15;

const TokenPayloadSchema = z.object({
  matterRef: z.string().min(1),
  sessionId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const session = verifyCookie(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const tokenKey = hashToken(session.sessionId);
  const [tk, gl] = await Promise.all([
    tokenLimiter.limit(tokenKey),
    globalLimiter.limit("global"),
  ]);
  // Fire-and-forget analytics writes; don't block the response on them
  void Promise.all([tk.pending, gl.pending]);

  if (!tk.success || !gl.success) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        return {
          allowedContentTypes: [...ALLOWED_CONTENT_TYPES],
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({
            matterRef: session.matterRef,
            sessionId: session.sessionId,
          }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const parsed = TokenPayloadSchema.parse(
          JSON.parse(tokenPayload ?? "{}")
        );
        await handleUploadCompleted({
          blob,
          matterRef: parsed.matterRef,
          sessionId: parsed.sessionId,
        });
      },
    });
    return NextResponse.json(json);
  } catch (err) {
    console.error("[late-upload] handleUpload error", err);
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }
}
