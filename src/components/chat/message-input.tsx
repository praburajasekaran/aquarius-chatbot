"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { SendHorizonal, Mic, MicOff } from "lucide-react";

interface MessageInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  suggestions?: string[];
  onSuggestionsDismissed?: () => void;
}

export function MessageInput({
  onSend,
  disabled,
  suggestions,
  onSuggestionsDismissed,
}: MessageInputProps) {
  const [input, setInput] = useState("");
  const [isListening, setIsListening] = useState(false);
  // Lazily evaluate Web Speech API support once on first render (client only).
  // Using a lazy initialiser avoids a synchronous setState inside an effect.
  const [speechSupported] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    if (!disabled) textareaRef.current?.focus();
  }, [disabled]);

  // Stop any active recognition on unmount to avoid leaking audio capture
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

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

  function handleChipClick(text: string) {
    if (disabled) return;
    onSend(text);
  }

  function handleInputChange(value: string) {
    setInput(value);
    // First keystroke dismisses the chip row — chips are only useful before
    // the user commits to typing.
    if (value.length > 0 && suggestions && suggestions.length > 0) {
      onSuggestionsDismissed?.();
    }
  }

  function handleMicClick() {
    if (isListening) {
      recognitionRef.current?.abort();
      setIsListening(false);
      return;
    }

    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-AU";
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      if (transcript) {
        setInput(transcript);
        // Focus so the user can review/edit before sending
        textareaRef.current?.focus();
      }
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      // start() throws if already running — reset state just in case
      setIsListening(false);
    }
  }

  const showChips = Array.isArray(suggestions) && suggestions.length > 0 && input.length === 0;

  return (
    <div className="border-t border-gray-200">
      {showChips && (
        <div className="px-3 pt-2 flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-gray-400 whitespace-nowrap">
            Quick reply
          </span>
          <span aria-hidden="true" className="h-3 w-px bg-gray-200" />
          {suggestions!.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => handleChipClick(option)}
              disabled={disabled}
              className="px-2.5 py-1 rounded-md border border-gray-200 bg-gray-50 text-gray-600 text-xs font-medium hover:bg-gray-100 hover:border-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {option}
            </button>
          ))}
        </div>
      )}

      <div className="p-3">
        <div className="flex items-end gap-2">
          <label htmlFor="chat-input" className="sr-only">
            Type your message
          </label>
          <textarea
            ref={textareaRef}
            id="chat-input"
            autoFocus
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Feel free to type anything here..."
            disabled={disabled}
            rows={1}
            /* text-base (16px) is the strict minimum to prevent iOS auto-zoom on focus */
            className="flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-base focus:border-[#085a66] focus:outline-none focus:ring-2 focus:ring-[#085a66] disabled:opacity-50"
          />

          {speechSupported && (
            <button
              type="button"
              onClick={handleMicClick}
              disabled={disabled}
              aria-label={isListening ? "Stop voice input" : "Start voice input"}
              aria-pressed={isListening}
              className={`shrink-0 h-11 w-11 rounded-xl flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                isListening
                  ? "bg-red-500 text-white hover:bg-red-600 animate-pulse"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {isListening ? (
                <MicOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Mic className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          )}

          {/* h-11 w-11 = 44px — meets WCAG 2.5.5 AAA minimum touch target */}
          <button
            type="button"
            onClick={handleSend}
            disabled={disabled || !input.trim()}
            aria-label="Send message"
            className="shrink-0 h-11 w-11 rounded-xl bg-[#085a66] text-white flex items-center justify-center hover:bg-[#064550] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <SendHorizonal className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
