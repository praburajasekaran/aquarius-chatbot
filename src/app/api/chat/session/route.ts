import { redis, deleteSession } from "@/lib/kv";

export async function DELETE(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const sessionId =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).sessionId
      : undefined;

  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return new Response("sessionId required", { status: 400 });
  }

  // Best-effort: failures here must not surface as 5xx since the client
  // treats this call as fire-and-forget. Log and return 204 either way.
  try {
    await deleteSession(sessionId);
  } catch (err) {
    console.error("[chat/session] deleteSession failed", { sessionId, err });
  }
  try {
    await redis.del(`transcript:${sessionId}`);
  } catch (err) {
    console.error("[chat/session] transcript del failed", { sessionId, err });
  }

  return new Response(null, { status: 204 });
}
