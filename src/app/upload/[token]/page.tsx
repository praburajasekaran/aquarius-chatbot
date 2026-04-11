import { notFound, redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { resolveUploadToken } from "@/lib/upload-tokens";
import { getLimiter } from "@/lib/rate-limit";
import { signCookie, COOKIE_NAME, COOKIE_MAX_AGE_SECONDS } from "@/lib/upload-session";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Upload your documents — Aquarius Lawyers",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (!ip) notFound();

  const { success } = await getLimiter.limit(ip);
  if (!success) notFound();

  const { token } = await params;
  const resolved = await resolveUploadToken(token);
  if (!resolved) notFound();

  const { record } = resolved;
  const exp = Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE_SECONDS;

  const cookieStore = await cookies();
  cookieStore.set(
    COOKIE_NAME,
    signCookie({
      matterRef: record.matterRef,
      sessionId: record.sessionId,
      exp,
    }),
    {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/upload",
      maxAge: COOKIE_MAX_AGE_SECONDS,
    }
  );

  redirect("/upload/session");
}
