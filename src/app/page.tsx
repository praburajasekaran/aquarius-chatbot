import { ChatWidget } from "@/components/chat/chat-widget";
import { Scale } from "lucide-react";

export default function Home() {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-brand/10 flex items-center justify-center">
            <Scale className="h-5 w-5 text-brand" />
          </div>
          <div>
            <h1 className="text-sm font-heading font-semibold text-gray-900">
              Aquarius Lawyers
            </h1>
            <p className="text-xs text-gray-500">Criminal Law Assistant</p>
          </div>
        </div>
      </header>

      {/* Chat */}
      <main className="flex-1 min-h-0">
        <ChatWidget />
      </main>
    </div>
  );
}
