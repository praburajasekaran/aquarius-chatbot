import { ChatWidget } from "@/components/chat/chat-widget";
import { Scale } from "lucide-react";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string; paid?: string }>;
}) {
  const params = await searchParams;
  const expired = params.expired === "1";
  const paid = params.paid === "1";

  return (
    <div className="flex flex-col h-full">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <header role="banner" className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-brand/10 flex items-center justify-center">
            <Scale className="h-5 w-5 text-brand" />
          </div>
          <div>
            <h1 className="text-base font-heading font-semibold text-gray-900">
              Aquarius Lawyers
            </h1>
            <p className="text-sm text-gray-500">Criminal Law Assistant</p>
          </div>
        </div>
      </header>

      {expired && (
        <div
          role="alert"
          className="mx-auto max-w-2xl w-full p-3 m-4 rounded-lg border border-amber-300 bg-amber-50 text-sm text-amber-900"
        >
          Your previous session has expired. Please restart your inquiry from the chat below.
        </div>
      )}
      {paid && (
        <div
          role="status"
          className="mx-auto max-w-2xl w-full p-3 m-4 rounded-lg border border-green-300 bg-green-50 text-sm text-green-900"
        >
          Payment already complete — thank you. We&apos;ll be in touch about scheduling.
        </div>
      )}

      <main id="main-content" className="flex-1 min-h-0">
        <ChatWidget />
      </main>
    </div>
  );
}
