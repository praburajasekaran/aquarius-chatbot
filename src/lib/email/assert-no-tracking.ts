import { resend } from "@/lib/resend";

// One-shot Promise cached at module scope so we only hit Resend once per
// serverless instance. Subsequent webhook invocations await the same value.
let cached: Promise<void> | null = null;

/**
 * Fails loudly if the configured Resend domain has click or open tracking
 * enabled. Rewriting our magic link through track.resend.com would leak the
 * upload token to Resend and any intermediate proxies.
 *
 * Dev and test environments short-circuit — we don't want to hammer the
 * Resend API (or require a real API key) for every local webhook.
 */
export function assertNoResendTracking(): Promise<void> {
  if (process.env.NODE_ENV !== "production") return Promise.resolve();
  if (!cached) cached = runCheck();
  return cached;
}

async function runCheck(): Promise<void> {
  try {
    const { data, error } = await resend.domains.list();
    if (error || !data) {
      console.warn(
        "[resend-tracking-assert] could not list domains; skipping check",
        error
      );
      return;
    }

    const domains = Array.isArray(data)
      ? data
      : (data as { data?: unknown[] }).data ?? [];

    for (const d of domains as Array<Record<string, unknown>>) {
      const clickTracking = Boolean(
        d["click_tracking"] ?? d["clickTracking"] ?? false
      );
      const openTracking = Boolean(
        d["open_tracking"] ?? d["openTracking"] ?? false
      );
      if (clickTracking || openTracking) {
        throw new Error(
          `Resend domain "${d["name"] ?? "?"}" has tracking enabled ` +
            `(click=${clickTracking}, open=${openTracking}). ` +
            `This rewrites the upload magic link through track.resend.com ` +
            `and leaks the token. Disable tracking in the Resend dashboard.`
        );
      }
    }
  } catch (err) {
    // Re-throw assertion failures; swallow transient Resend errors so the
    // webhook doesn't get stuck in a retry loop if Resend is having a bad day.
    if (
      err instanceof Error &&
      err.message.startsWith("Resend domain")
    ) {
      throw err;
    }
    console.warn(
      "[resend-tracking-assert] check failed transiently; skipping",
      err
    );
  }
}
