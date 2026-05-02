import { NextResponse } from "next/server";
import type { ZodType } from "zod";

type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: Response };

export async function parseJsonBody<T>(
  req: Request,
  schema: ZodType<T>
): Promise<ParseResult<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "bad_json" }, { status: 400 }),
    };
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    return {
      ok: false,
      response: NextResponse.json({ error: "bad_payload" }, { status: 400 }),
    };
  }

  return { ok: true, data: result.data };
}
