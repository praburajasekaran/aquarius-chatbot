import { ChatWidget } from "@/components/chat/chat-widget";

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
