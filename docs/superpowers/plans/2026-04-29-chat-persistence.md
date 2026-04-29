# Chat Persistence + End Chat + Client Transcript Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the chat across page navigation and browser close (6h sliding TTL), give visitors a safety-focused "End chat" button, and include the transcript in the payment-success receipt email.

**Architecture:** Browser `localStorage` (key `aquarius_chat_v1`) holds `{sessionId, messages, expiresAt}`. The widget loads from storage on mount and saves after every settled turn. Reset triggers are TTL expiry (passive) and manual End Chat (with confirm). Server `SESSION_TTL` bumps from 1h → 6h to match. The post-payment receipt email gains a "Conversation summary" section reading from the existing `transcript:${sessionId}` Redis key.

**Tech Stack:** Next.js (App Router) · TypeScript · React 19 · `@ai-sdk/react` `useChat` · Tailwind v4 · Lucide React · Upstash Redis · Resend / @react-email/components · Vitest

**Spec:** [docs/superpowers/specs/2026-04-29-chat-persistence-design.md](../specs/2026-04-29-chat-persistence-design.md)

---

## File Structure

**New files:**
- `src/lib/chat-persistence.ts` — pure browser module wrapping localStorage. Exports `loadChat()`, `saveChat()`, `clearChat()`. ~60 lines.
- `src/lib/__tests__/chat-persistence.test.ts` — unit tests covering valid load, expiry, schema mismatch, malformed JSON, save+expiry refresh, clear.
- `src/app/api/chat/session/route.ts` — `DELETE` handler that calls `deleteSession(sessionId)` and `redis.del(transcript:${sessionId})`. Returns 204.
- `src/app/api/chat/session/__tests__/route.test.ts` — unit test for the DELETE route.
- `src/components/chat/end-chat-button.tsx` — small icon button (Lucide `RotateCcw`).
- `src/components/chat/end-chat-dialog.tsx` — confirm dialog with backdrop, focus trap, Esc to close.

**Modified files:**
- `src/lib/kv.ts` — `SESSION_TTL` 3600 → 21600.
- `src/components/chat/chat-widget.tsx` — replace `generateSessionId` with `loadChat()`, add save effect, render `EndChatButton` + `EndChatDialog`, implement `endChat()`.
- `src/lib/email/payment-receipt.tsx` — accept optional `transcript?: string` prop, render Conversation summary section.
- `src/lib/intake/handle-paid.ts` — move transcript fetch above receipt block, pass to `PaymentReceipt`.

**Files NOT touched:**
- `src/app/api/chat/route.ts` — transcript-write logic already exists.
- `src/lib/resend.ts` — `sendTranscriptEmail` to firm already works.
- `src/app/demo/chat-widget-embed.tsx` — iframe wrapper; persistence is internal to the iframe.

---

## Task 1: Bump server SESSION_TTL to 6h

**Files:**
- Modify: `src/lib/kv.ts`

- [ ] **Step 1: Change the TTL constant**

Edit `src/lib/kv.ts` line 9:

```ts
const SESSION_TTL = 6 * 60 * 60; // 6 hours
```

(Was `const SESSION_TTL = 3600; // 1 hour`.)

- [ ] **Step 2: Run the existing tests to verify nothing broke**

Run: `npm test`
Expected: all existing tests still pass (TTL is read by `createSession` / `updateSession` only; existing tests don't assert on TTL value).

- [ ] **Step 3: Run the build to verify TypeScript compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/kv.ts
git commit -m "chore(kv): extend SESSION_TTL from 1h to 6h"
```

---

## Task 2: Create chat-persistence.ts module (TDD)

**Files:**
- Create: `src/lib/chat-persistence.ts`
- Create: `src/lib/__tests__/chat-persistence.test.ts`

The module owns ALL `localStorage` access for chat state. It must degrade gracefully when storage is unavailable (private mode, blocked, quota exceeded). All errors are swallowed — never throw.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/chat-persistence.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ChatMessage } from "@/lib/tools";

// Minimal in-memory localStorage mock. Vitest runs in node by default,
// so globalThis.localStorage doesn't exist — install our own.
function installMockStorage() {
  const store = new Map<string, string>();
  const mock = {
    getItem: vi.fn((k: string) => store.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => {
      store.set(k, v);
    }),
    removeItem: vi.fn((k: string) => {
      store.delete(k);
    }),
    clear: vi.fn(() => store.clear()),
    key: vi.fn(() => null),
    length: 0,
  };
  vi.stubGlobal("localStorage", mock);
  return { store, mock };
}

const KEY = "aquarius_chat_v1";

const sampleMessages: ChatMessage[] = [
  // Cast through unknown — ChatMessage is a complex AI-SDK type and
  // we only need shape coverage for serialization tests.
  { id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] } as unknown as ChatMessage,
  { id: "m2", role: "assistant", parts: [{ type: "text", text: "hello" }] } as unknown as ChatMessage,
];

describe("chat-persistence", () => {
  beforeEach(() => {
    installMockStorage();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("loadChat", () => {
    it("mints a fresh session when storage is empty", async () => {
      const { loadChat } = await import("@/lib/chat-persistence");
      const result = loadChat();
      expect(result.sessionId).toMatch(/^s_\d+_[a-z0-9]+$/);
      expect(result.initialMessages).toEqual([]);
    });

    it("restores stored sessionId and messages when valid and unexpired", async () => {
      const { loadChat, saveChat } = await import("@/lib/chat-persistence");
      saveChat("s_existing_abc", sampleMessages);
      const result = loadChat();
      expect(result.sessionId).toBe("s_existing_abc");
      expect(result.initialMessages).toHaveLength(2);
      expect(result.initialMessages[0].id).toBe("m1");
    });

    it("mints fresh and wipes when stored entry is expired", async () => {
      const { loadChat } = await import("@/lib/chat-persistence");
      const expiredPayload = {
        schemaVersion: 1,
        sessionId: "s_old",
        messages: sampleMessages,
        expiresAt: Date.now() - 1000,
      };
      localStorage.setItem(KEY, JSON.stringify(expiredPayload));

      const result = loadChat();
      expect(result.sessionId).not.toBe("s_old");
      expect(result.initialMessages).toEqual([]);
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it("mints fresh when schemaVersion does not match", async () => {
      const { loadChat } = await import("@/lib/chat-persistence");
      const otherSchema = {
        schemaVersion: 999,
        sessionId: "s_old",
        messages: [],
        expiresAt: Date.now() + 60_000,
      };
      localStorage.setItem(KEY, JSON.stringify(otherSchema));

      const result = loadChat();
      expect(result.sessionId).not.toBe("s_old");
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it("mints fresh when stored payload is malformed JSON", async () => {
      const { loadChat } = await import("@/lib/chat-persistence");
      localStorage.setItem(KEY, "{not valid json");

      const result = loadChat();
      expect(result.sessionId).toMatch(/^s_/);
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it("mints fresh when localStorage throws on read", async () => {
      const { loadChat } = await import("@/lib/chat-persistence");
      vi.spyOn(localStorage, "getItem").mockImplementation(() => {
        throw new Error("storage disabled");
      });
      const result = loadChat();
      expect(result.sessionId).toMatch(/^s_/);
      expect(result.initialMessages).toEqual([]);
    });
  });

  describe("saveChat", () => {
    it("writes payload with sliding 6h expiresAt", async () => {
      const { saveChat } = await import("@/lib/chat-persistence");
      saveChat("s_x", sampleMessages);
      const raw = localStorage.getItem(KEY);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.sessionId).toBe("s_x");
      expect(parsed.messages).toHaveLength(2);
      const sixHoursMs = 6 * 60 * 60 * 1000;
      expect(parsed.expiresAt).toBe(Date.now() + sixHoursMs);
    });

    it("refreshes expiresAt on subsequent saves", async () => {
      const { saveChat } = await import("@/lib/chat-persistence");
      saveChat("s_x", sampleMessages);
      vi.advanceTimersByTime(60_000);
      saveChat("s_x", sampleMessages);
      const parsed = JSON.parse(localStorage.getItem(KEY)!);
      const sixHoursMs = 6 * 60 * 60 * 1000;
      expect(parsed.expiresAt).toBe(Date.now() + sixHoursMs);
    });

    it("silently no-ops when localStorage throws", async () => {
      const { saveChat } = await import("@/lib/chat-persistence");
      vi.spyOn(localStorage, "setItem").mockImplementation(() => {
        throw new Error("quota exceeded");
      });
      // Must NOT throw.
      expect(() => saveChat("s_x", sampleMessages)).not.toThrow();
    });
  });

  describe("clearChat", () => {
    it("removes the stored entry", async () => {
      const { saveChat, clearChat } = await import("@/lib/chat-persistence");
      saveChat("s_x", sampleMessages);
      expect(localStorage.getItem(KEY)).not.toBeNull();
      clearChat();
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it("silently no-ops when localStorage throws", async () => {
      const { clearChat } = await import("@/lib/chat-persistence");
      vi.spyOn(localStorage, "removeItem").mockImplementation(() => {
        throw new Error("nope");
      });
      expect(() => clearChat()).not.toThrow();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/__tests__/chat-persistence.test.ts`
Expected: FAIL — "Cannot find module '@/lib/chat-persistence'"

- [ ] **Step 3: Implement the module**

Create `src/lib/chat-persistence.ts`:

```ts
import type { ChatMessage } from "@/lib/tools";

const KEY = "aquarius_chat_v1";
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const SCHEMA_VERSION = 1 as const;

interface Stored {
  schemaVersion: typeof SCHEMA_VERSION;
  sessionId: string;
  messages: ChatMessage[];
  expiresAt: number;
}

function generateSessionId(): string {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function safeRemove(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // localStorage may be unavailable; nothing to do.
  }
}

function isStored(value: unknown): value is Stored {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.schemaVersion === SCHEMA_VERSION &&
    typeof v.sessionId === "string" &&
    Array.isArray(v.messages) &&
    typeof v.expiresAt === "number"
  );
}

export function loadChat(): {
  sessionId: string;
  initialMessages: ChatMessage[];
} {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return { sessionId: generateSessionId(), initialMessages: [] };
  }

  if (!raw) {
    return { sessionId: generateSessionId(), initialMessages: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    safeRemove();
    return { sessionId: generateSessionId(), initialMessages: [] };
  }

  if (!isStored(parsed)) {
    safeRemove();
    return { sessionId: generateSessionId(), initialMessages: [] };
  }

  if (parsed.expiresAt <= Date.now()) {
    safeRemove();
    return { sessionId: generateSessionId(), initialMessages: [] };
  }

  return {
    sessionId: parsed.sessionId,
    initialMessages: parsed.messages,
  };
}

export function saveChat(sessionId: string, messages: ChatMessage[]): void {
  const payload: Stored = {
    schemaVersion: SCHEMA_VERSION,
    sessionId,
    messages,
    expiresAt: Date.now() + TTL_MS,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // Quota exceeded, storage disabled, etc. Silently degrade.
  }
}

export function clearChat(): void {
  safeRemove();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/__tests__/chat-persistence.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Run lint and the full test suite**

Run: `npm run lint && npm test`
Expected: lint clean, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/chat-persistence.ts src/lib/__tests__/chat-persistence.test.ts
git commit -m "feat(chat): add chat-persistence module with localStorage-backed load/save/clear"
```

---

## Task 3: Wire chat-persistence into ChatWidget (load + save)

**Files:**
- Modify: `src/components/chat/chat-widget.tsx`

This task only adds load + save. End Chat button arrives in Task 7.

- [ ] **Step 1: Replace the sessionId source and add initial messages**

In `src/components/chat/chat-widget.tsx`, replace the existing `generateSessionId` function (lines 11-13) and the `useState(generateSessionId)` call (line 87).

Remove the local `generateSessionId` function entirely (lines 11-13). Then change the state declaration:

```ts
// at top of component, replacing: const [sessionId] = useState(generateSessionId);
const [persisted, setPersisted] = useState(loadChat);
const { sessionId, initialMessages } = persisted;
```

Add the import at the top of the file:

```ts
import { loadChat, saveChat } from "@/lib/chat-persistence";
```

- [ ] **Step 2: Pass initialMessages into useChat**

Change the `useChat` call:

```ts
const { messages, sendMessage, addToolOutput, status, setMessages, stop } = useChat<ChatMessage>({
  transport,
  sendAutomaticallyWhen: shouldAutoContinue,
  messages: initialMessages,
});
```

Note: `messages: initialMessages` is the AI SDK v6 prop name for hydrating the initial state. Also pull `setMessages` and `stop` from the return — both are needed in Task 7.

- [ ] **Step 3: Add the save effect**

Below the existing scroll effect, add:

```ts
useEffect(() => {
  if (status !== "ready") return;
  if (messages.length === 0) return;
  saveChat(sessionId, messages);
}, [messages, status, sessionId]);
```

Place this immediately after the existing `useEffect` that calls `messagesEndRef.current?.scrollIntoView` so related effects sit together.

- [ ] **Step 4: Verify it compiles**

Run: `npm run build`
Expected: build succeeds. If `setPersisted` shows as "declared but never used," that's fine for this task — Task 7 uses it.

To silence the lint warning meanwhile, prefix with underscore:

```ts
const [persisted, _setPersisted] = useState(loadChat);
```

- [ ] **Step 5: Manual verify in dev**

Run: `npm run dev`
Open http://localhost:3000 (or the demo page). Type "hello" and wait for the assistant reply. Open DevTools → Application → Local Storage → http://localhost:3000 → confirm `aquarius_chat_v1` key with a JSON value containing `sessionId`, `messages`, `expiresAt`. Reload the page → conversation is restored.

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/chat-widget.tsx
git commit -m "feat(chat): persist conversation across reloads via chat-persistence"
```

---

## Task 4: Create DELETE /api/chat/session route (TDD)

**Files:**
- Create: `src/app/api/chat/session/route.ts`
- Create: `src/app/api/chat/session/__tests__/route.test.ts`

Idempotent endpoint. Wipes both `session:${sessionId}` (via `deleteSession`) and `transcript:${sessionId}`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/chat/session/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/kv", () => ({
  redis: { del: vi.fn() },
  deleteSession: vi.fn(),
}));

import { redis, deleteSession } from "@/lib/kv";
import { DELETE } from "@/app/api/chat/session/route";

function makeRequest(body: unknown): Request {
  return new Request("http://test/api/chat/session", {
    method: "DELETE",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("DELETE /api/chat/session", () => {
  beforeEach(() => {
    vi.mocked(deleteSession).mockResolvedValue(undefined);
    vi.mocked(redis.del).mockResolvedValue(0);
  });

  it("returns 204 and deletes session + transcript when sessionId is provided", async () => {
    const res = await DELETE(makeRequest({ sessionId: "s_abc" }));
    expect(res.status).toBe(204);
    expect(vi.mocked(deleteSession)).toHaveBeenCalledWith("s_abc");
    expect(vi.mocked(redis.del)).toHaveBeenCalledWith("transcript:s_abc");
  });

  it("returns 400 when sessionId is missing", async () => {
    const res = await DELETE(makeRequest({}));
    expect(res.status).toBe(400);
    expect(vi.mocked(deleteSession)).not.toHaveBeenCalled();
    expect(vi.mocked(redis.del)).not.toHaveBeenCalled();
  });

  it("returns 400 when sessionId is not a string", async () => {
    const res = await DELETE(makeRequest({ sessionId: 123 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when body is not valid JSON", async () => {
    const req = new Request("http://test/api/chat/session", {
      method: "DELETE",
      body: "not json",
      headers: { "content-type": "application/json" },
    });
    const res = await DELETE(req);
    expect(res.status).toBe(400);
  });

  it("returns 204 even when redis.del throws (best-effort)", async () => {
    vi.mocked(redis.del).mockRejectedValueOnce(new Error("boom"));
    const res = await DELETE(makeRequest({ sessionId: "s_abc" }));
    expect(res.status).toBe(204);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/app/api/chat/session/__tests__/route.test.ts`
Expected: FAIL — "Cannot find module '@/app/api/chat/session/route'"

- [ ] **Step 3: Implement the route**

Create `src/app/api/chat/session/route.ts`:

```ts
import { redis, deleteSession } from "@/lib/kv";

export async function DELETE(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const sessionId =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).sessionId
      : undefined;

  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return new Response("sessionId required", { status: 400 });
  }

  // Best-effort: failures here must not surface as 5xx since the client
  // treats this call as fire-and-forget. Log and return 204 either way.
  try {
    await deleteSession(sessionId);
  } catch (err) {
    console.error("[chat/session] deleteSession failed", { sessionId, err });
  }
  try {
    await redis.del(`transcript:${sessionId}`);
  } catch (err) {
    console.error("[chat/session] transcript del failed", { sessionId, err });
  }

  return new Response(null, { status: 204 });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/app/api/chat/session/__tests__/route.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Run lint and full test suite**

Run: `npm run lint && npm test`
Expected: lint clean, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/chat/session/route.ts src/app/api/chat/session/__tests__/route.test.ts
git commit -m "feat(api): add DELETE /api/chat/session for End Chat cleanup"
```

---

## Task 5: Create EndChatDialog component

**Files:**
- Create: `src/components/chat/end-chat-dialog.tsx`

The dialog is a controlled component. Parent (`ChatWidget`) owns `open` state and `onConfirm` / `onCancel` callbacks.

- [ ] **Step 1: Implement the component**

Create `src/components/chat/end-chat-dialog.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";

interface EndChatDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function EndChatDialog({ open, onConfirm, onCancel }: EndChatDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  // Focus the destructive action when the dialog opens, and trap Esc.
  useEffect(() => {
    if (!open) return;
    confirmButtonRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onCancel}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="end-chat-dialog-title"
        aria-describedby="end-chat-dialog-desc"
        className="bg-white rounded-xl shadow-xl mx-4 max-w-xs w-full p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="end-chat-dialog-title"
          className="text-base font-semibold text-slate-900 mb-2"
        >
          End this chat?
        </h2>
        <p
          id="end-chat-dialog-desc"
          className="text-sm text-slate-600 mb-5"
        >
          Your conversation will be cleared from this device.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded-md text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
          >
            Cancel
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={onConfirm}
            className="px-3 py-1.5 text-sm rounded-md bg-brand text-white hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            End chat
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/end-chat-dialog.tsx
git commit -m "feat(chat): add EndChatDialog confirm component"
```

---

## Task 6: Create EndChatButton component

**Files:**
- Create: `src/components/chat/end-chat-button.tsx`

Tiny presentational button. The parent decides when to show it.

- [ ] **Step 1: Implement the component**

Create `src/components/chat/end-chat-button.tsx`:

```tsx
"use client";

import { RotateCcw } from "lucide-react";

interface EndChatButtonProps {
  onClick: () => void;
}

export function EndChatButton({ onClick }: EndChatButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="End chat"
      title="End chat"
      className="absolute top-2 right-2 z-10 inline-flex items-center justify-center h-8 w-8 rounded-full text-slate-500 hover:text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors"
    >
      <RotateCcw className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
    </button>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/end-chat-button.tsx
git commit -m "feat(chat): add EndChatButton header control"
```

---

## Task 7: Wire End Chat flow into ChatWidget

**Files:**
- Modify: `src/components/chat/chat-widget.tsx`

This consumes Tasks 2, 4, 5, 6 and finishes the feature.

- [ ] **Step 1: Add imports**

At the top of `src/components/chat/chat-widget.tsx`, add:

```ts
import { clearChat } from "@/lib/chat-persistence";
import { EndChatButton } from "./end-chat-button";
import { EndChatDialog } from "./end-chat-dialog";
```

(Keep the existing `import { loadChat, saveChat } from "@/lib/chat-persistence";` — extend it to include `clearChat`, or use a separate import line. Either is fine.)

Recommended: consolidate into one line:

```ts
import { loadChat, saveChat, clearChat } from "@/lib/chat-persistence";
```

- [ ] **Step 2: Promote `_setPersisted` to `setPersisted`**

If you prefixed it with underscore in Task 3 to silence lint, drop the prefix now:

```ts
const [persisted, setPersisted] = useState(loadChat);
const { sessionId, initialMessages } = persisted;
```

- [ ] **Step 3: Add the End Chat dialog state**

Inside `ChatWidget`, near the other `useState` calls:

```ts
const [endChatOpen, setEndChatOpen] = useState(false);
```

- [ ] **Step 4: Implement the endChat callback**

Add inside the component (e.g., right after the other `handle*` functions):

```ts
async function handleEndChatConfirm() {
  // Stop any in-flight stream so partial assistant turns don't leak past reset.
  if (status === "streaming" || status === "submitted") {
    stop();
  }
  clearChat();
  // Best-effort server cleanup. We never block the UI on this.
  fetch("/api/chat/session", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId }),
  }).catch(() => {
    // Network/server error is acceptable — server-side TTL will reap it later.
  });
  setMessages([]);
  setDismissedForMessageId(null);
  // Re-load: localStorage was just cleared, so this returns a fresh sessionId
  // and empty messages.
  setPersisted(loadChat());
  setEndChatOpen(false);
}
```

- [ ] **Step 5: Render EndChatButton and EndChatDialog**

Modify the JSX returned by `ChatWidget`. The current root is:

```tsx
return (
  <div className="flex flex-col h-full bg-white" aria-label="Criminal Law Assistant chat">
    <DisclaimerBanner />
    <MessageList ... />
    ...
  </div>
);
```

Change to (note the added `relative` so absolute children position correctly, and the conditional `EndChatButton` + always-mounted `EndChatDialog`):

```tsx
return (
  <div className="relative flex flex-col h-full bg-white" aria-label="Criminal Law Assistant chat">
    {messages.length > 0 && (
      <EndChatButton onClick={() => setEndChatOpen(true)} />
    )}
    <DisclaimerBanner />
    <MessageList ... />
    ...
    <EndChatDialog
      open={endChatOpen}
      onConfirm={handleEndChatConfirm}
      onCancel={() => setEndChatOpen(false)}
    />
  </div>
);
```

(Leave the `<MessageList ... />` inner props exactly as they were.)

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Manual verification**

Run: `npm run dev`. Open the chat, send a message, wait for the reply. Then:

1. Confirm `EndChatButton` (RotateCcw icon, top-right) is visible.
2. Click it → dialog appears with backdrop.
3. Press Esc → dialog closes, conversation intact.
4. Click backdrop → dialog closes, conversation intact.
5. Click "Cancel" → same.
6. Click "End chat" → conversation cleared, fresh welcome state with chips, new `sessionId` in `localStorage` (DevTools), `EndChatButton` no longer visible.
7. In Network panel, verify `DELETE /api/chat/session` returned 204.
8. End Chat mid-stream: send a message, immediately click End Chat → confirm → stream cancels and chat clears.
9. Reload the page after a settled conversation → conversation restored.

- [ ] **Step 8: Run lint and full test suite**

Run: `npm run lint && npm test`
Expected: lint clean, all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/components/chat/chat-widget.tsx
git commit -m "feat(chat): wire End Chat button + confirm dialog"
```

---

## Task 8: Add transcript prop to PaymentReceipt

**Files:**
- Modify: `src/lib/email/payment-receipt.tsx`

- [ ] **Step 1: Update the props interface and component signature**

Open `src/lib/email/payment-receipt.tsx`. Replace lines 14-19 (the interface):

```ts
export interface PaymentReceiptProps {
  name?: string;
  matterRef: string;
  amountCents: number;
  uploadLink: string;
  transcript?: string;
}
```

Update the component signature on line 28-33:

```ts
export default function PaymentReceipt({
  name,
  matterRef,
  amountCents,
  uploadLink,
  transcript,
}: PaymentReceiptProps) {
```

- [ ] **Step 2: Render the conversation summary section**

Inside the `<Container>` (between the existing `<Text style={footer}>` block and the closing `</Container>`), add:

```tsx
{transcript && transcript.trim().length > 0 && (
  <Section style={transcriptSection}>
    <Heading as="h2" style={transcriptHeading}>
      Conversation summary
    </Heading>
    <Text style={transcriptText}>{transcript}</Text>
  </Section>
)}
```

Then add the new style objects below the existing `footer` constant at the bottom of the file:

```ts
const transcriptSection: React.CSSProperties = {
  marginTop: "32px",
  paddingTop: "24px",
  borderTop: "1px solid #e5e5e5",
};

const transcriptHeading: React.CSSProperties = {
  color: "#1a1a1a",
  fontSize: "16px",
  fontWeight: 600,
  margin: "0 0 12px",
};

const transcriptText: React.CSSProperties = {
  color: "#333333",
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: "13px",
  lineHeight: "20px",
  whiteSpace: "pre-wrap",
  margin: 0,
};
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Sanity-check the rendered output**

Run a quick render to confirm the transcript HTML looks right. From a Node REPL or a one-liner:

```bash
node -e "
const { render } = require('@react-email/render');
const Receipt = require('./src/lib/email/payment-receipt').default;
const React = require('react');
render(React.createElement(Receipt, {
  matterRef: 's_test',
  amountCents: 19900,
  uploadLink: 'https://example.com/u/x',
  transcript: 'Client: hi\\n\\nChatbot: hello'
})).then(html => console.log(html.includes('Conversation summary'), html.includes('Client: hi')));
"
```

Expected output: `true true`. (If the project doesn't run `.tsx` directly through Node, skip this step — Task 9's full pipeline test will exercise it.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/email/payment-receipt.tsx
git commit -m "feat(email): add optional transcript section to PaymentReceipt"
```

---

## Task 9: Pass transcript to PaymentReceipt in handle-paid.ts

**Files:**
- Modify: `src/lib/intake/handle-paid.ts`

- [ ] **Step 1: Move the transcript fetch above the receipt block**

Currently in `src/lib/intake/handle-paid.ts`, the transcript is fetched at lines 161-163 (inside the firm-email block). Move it up so both the client receipt and the firm transcript can use it.

Insert these lines immediately after `const uploadLink = \`${appUrl}/upload/${rawToken}\`;` (around line 127, before `// 4. Receipt email`):

```ts
// Pre-fetch the stored transcript so both the client receipt and the firm
// notification can include it. Failure here is non-fatal — both emails
// degrade to "no conversation summary" rather than fail the fan-out.
const storedTranscript = await redis
  .get<string>(`transcript:${sessionId}`)
  .catch(() => null);
```

- [ ] **Step 2: Pass transcript to PaymentReceipt**

In the receipt-email block (around line 138), update the `react: PaymentReceipt(...)` call to include the transcript:

```ts
react: PaymentReceipt({
  name: clientName || undefined,
  matterRef: sessionId,
  amountCents: paymentAmount,
  uploadLink,
  transcript: storedTranscript ?? undefined,
}),
```

- [ ] **Step 3: Remove the duplicate transcript fetch in the firm-email block**

Around line 161, the firm block currently has:

```ts
const intake = await getIntake(sessionId);
const storedTranscript = await redis
  .get<string>(`transcript:${sessionId}`)
  .catch(() => null);
```

Delete the second fetch (the `storedTranscript` re-declaration) — keep only `const intake = await getIntake(sessionId);`. The `storedTranscript` from Step 1 is already in scope.

After the edit, that block reads:

```ts
// 5. Firm transcript — best-effort, requires intake record
const intake = await getIntake(sessionId);

if (intake) {
  try {
    await sendTranscriptEmail({
      clientName: intake.clientName ?? clientName,
      clientEmail: intake.clientEmail ?? clientEmail,
      clientPhone: intake.clientPhone ?? "N/A",
      matterDescription: intake.matterDescription ?? "N/A",
      urgency: intake.urgency ?? "N/A",
      paymentAmount,
      stripeSessionId: paymentRef,
      transcript: storedTranscript ?? undefined,
    });
  } catch (err) {
    // ... unchanged
  }
} else {
  // ... unchanged
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Verify the existing test suite still passes**

Run: `npm run lint && npm test`
Expected: lint clean, all tests pass.

- [ ] **Step 6: Manual end-to-end verification**

Run: `npm run dev`. Walk through a complete intake in the demo flow that ends in payment success. After payment completes, check the inbox for `RESEND_FROM_EMAIL` recipient (or the test-mode Resend dashboard). The receipt email body should now contain a "Conversation summary" section with the chat transcript ("Client: ...\n\nChatbot: ...").

If you don't have Resend test credentials handy, alternatively run the demo bypass at `POST /api/intake/bypass-paid` and tail the dev server logs to confirm `[intake] receipt email failed` does NOT appear and that the receipt email send succeeded.

- [ ] **Step 7: Commit**

```bash
git add src/lib/intake/handle-paid.ts
git commit -m "feat(intake): include transcript in client payment receipt"
```

---

## Task 10: End-to-end verification & PR

- [ ] **Step 1: Final integration walk-through**

Run: `npm run dev`. Complete this full scenario:

1. Open the chat, type "hi", get welcome chips → click one → continue intake to the urgency selection.
2. Reload the page → conversation restored, including the chips already chosen.
3. Open a second tab on the same origin → conversation restored there too (shared `localStorage`).
4. Click End Chat → confirm → conversation cleared in this tab. (Other tab is stale until it next saves or is reloaded — this is acceptable.)
5. Start a fresh chat, complete payment via the demo flow.
6. Verify the receipt email now contains the conversation summary.
7. Verify the firm transcript email still works (unchanged behavior).

- [ ] **Step 2: Run all checks one last time**

Run: `npm run lint && npm test && npm run build`
Expected: all clean.

- [ ] **Step 3: Open the PR**

```bash
git push -u origin claude/reverent-goodall-07eaef
gh pr create --title "feat: persist chat across sessions, add End Chat, transcript in receipt" --body "$(cat <<'EOF'
## Summary
- Persist chat conversation across page navigation and browser close via `localStorage` with a 6h sliding TTL
- Add End Chat button (with confirm dialog) for safety/PII clearing on shared devices
- Include the conversation transcript in the post-payment client receipt email
- Bump server `SESSION_TTL` from 1h to 6h to match client retention window

## Spec
- [docs/superpowers/specs/2026-04-29-chat-persistence-design.md](docs/superpowers/specs/2026-04-29-chat-persistence-design.md)

## Plan
- [docs/superpowers/plans/2026-04-29-chat-persistence.md](docs/superpowers/plans/2026-04-29-chat-persistence.md)

## Test plan
- [ ] Type a message, reload page → conversation restored
- [ ] Type a message, close + reopen browser within 6h → restored
- [ ] Wait past 6h (or shorten TTL locally) → fresh chat
- [ ] End Chat → confirm → conversation cleared, fresh sessionId, server session deleted
- [ ] End Chat → cancel/Esc/backdrop → no change
- [ ] End Chat mid-stream → stream cancels, chat clears
- [ ] Block localStorage in DevTools → widget still works (no persistence)
- [ ] Complete payment → receipt email contains "Conversation summary" section
- [ ] Firm transcript email still arrives (unchanged path)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Confirm CI is green and post the PR URL**

Run: `gh pr view --web` and paste the URL into chat.

---

## Self-Review Checklist (already run inline; recorded for the executor)

- [x] Spec coverage: every section of the spec maps to a task. Persistence (Task 2 + Task 3), End Chat button + dialog + confirm UX (Tasks 5, 6, 7), DELETE endpoint (Task 4), server TTL bump (Task 1), client transcript (Tasks 8, 9), edge cases tested in Task 2 (storage disabled, expired, malformed) and Task 4 (best-effort failure).
- [x] No placeholders. Every step shows the actual code or command.
- [x] Type consistency. `loadChat()` returns `{ sessionId, initialMessages }` everywhere. `saveChat(sessionId, messages)` is the only signature used. `clearChat()` matches the spec. `EndChatButton` + `EndChatDialog` props match between Tasks 5/6 and Task 7's wiring. `PaymentReceipt`'s new `transcript?: string` prop matches between Tasks 8 and 9.
