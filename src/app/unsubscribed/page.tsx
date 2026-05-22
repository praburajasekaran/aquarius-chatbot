import type { Metadata } from "next";
import Link from "next/link";
import { BRANDING } from "@/lib/branding";

/**
 * Branded confirmation page after a successful one-click unsubscribe.
 *
 * Server component (App Router default — no "use client" directive). Pulls
 * the firm name from BRANDING (env-driven) so the whitelabel works without
 * code changes. `robots: { index: false }` keeps this page out of search
 * results — the URL is only ever reached from a redirect, not navigation.
 */

export const metadata: Metadata = {
  title: `Unsubscribed — ${BRANDING.firmName}`,
  robots: { index: false, follow: false },
};

export default function UnsubscribedPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-white p-8">
      <div className="max-w-md text-center space-y-6">
        <h1
          className="text-2xl font-semibold"
          style={{ fontFamily: "Rubik, sans-serif" }}
        >
          {BRANDING.firmName}
        </h1>
        <p
          className="text-base text-gray-700"
          style={{ fontFamily: "'Open Sans', sans-serif" }}
        >
          You won&apos;t receive further reminders for this inquiry from{" "}
          {BRANDING.firmName}.
        </p>
        <Link
          href="/"
          className="inline-block px-6 py-3 rounded-md text-white"
          style={{
            background: "#61BBCA",
            fontFamily: "'Open Sans', sans-serif",
          }}
        >
          Return to homepage
        </Link>
      </div>
    </main>
  );
}
