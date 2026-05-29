import { NextResponse } from "next/server";
import { z } from "zod";
import { clientErrorLimiter } from "@/lib/rate-limit";
import { logOpsEvent } from "@/lib/ops-events";

const ClientErrorSchema = z.object({
  event: z.enum([
    "client_runtime_error",
    "client_unhandled_rejection",
    "client_console_warning",
  ]),
  message: z.string().min(1).max(500),
  source: z.string().max(500).optional(),
  stack: z.string().max(500).optional(),
  path: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  const { success } = await clientErrorLimiter.limit(ip);
  if (!success) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ClientErrorSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  await logOpsEvent({
    severity: parsed.data.event === "client_console_warning" ? "warning" : "error",
    event: parsed.data.event,
    area: "client",
    message: parsed.data.message,
    metadata: {
      source: parsed.data.source,
      path: parsed.data.path,
      stack: parsed.data.stack,
      userAgent: req.headers.get("user-agent") ?? "unknown",
    },
  });

  return NextResponse.json({ ok: true });
}
