"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { SendHorizonal } from "lucide-react";

interface MessageInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export function MessageInput({ onSend, disabled }: MessageInputProps) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!disabled) textareaRef.current?.focus();
  }, [disabled]);

  function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setInput("");
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="border-t border-gray-200 p-3">
      <div className="flex items-end gap-2">
        <label htmlFor="chat-input" className="sr-only">
          Type your message
        </label>
        <textarea
          ref={textareaRef}
          id="chat-input"
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your question..."
          disabled={disabled}
          rows={1}
          /* text-base (16px) is the strict minimum to prevent iOS auto-zoom on focus */
          className="flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-base focus:border-[#085a66] focus:outline-none focus:ring-2 focus:ring-[#085a66] disabled:opacity-50"
        />
        {/* h-11 w-11 = 44px — meets WCAG 2.5.5 AAA minimum touch target */}
        <button
          onClick={handleSend}
          disabled={disabled || !input.trim()}
          aria-label="Send message"
          className="shrink-0 h-11 w-11 rounded-xl bg-[#085a66] text-white flex items-center justify-center hover:bg-[#064550] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <SendHorizonal className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
