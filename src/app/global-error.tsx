"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    void fetch("/api/ops/client-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: "client_runtime_error",
        message: error.message || "Global application error",
        stack: error.stack?.slice(0, 500),
        path: window.location.pathname,
      }),
    }).catch(() => undefined);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="min-h-screen bg-white text-gray-900 flex items-center justify-center p-6">
          <div className="max-w-md space-y-4 text-center">
            <h1 className="text-2xl font-semibold">Something went wrong</h1>
            <p className="text-sm text-gray-700">
              We have logged the issue. Please refresh the page.
            </p>
          </div>
        </main>
      </body>
    </html>
  );
}
