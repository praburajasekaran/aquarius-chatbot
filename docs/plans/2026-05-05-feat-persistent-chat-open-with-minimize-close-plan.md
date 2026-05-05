---
title: Persistent open chat widget with minimize and close controls
type: feat
date: 2026-05-05
---

# Persistent open chat widget with minimize and close controls

## Overview

Today the chat widget on a host site (e.g. aquariuslawyers.com.au, served via `public/embed.js`) is **closed by default** and re-initialises on every page navigation, so a visitor who opened the chat on `/about` finds it collapsed again on `/services`. The conversation itself persists (localStorage on the chatbot origin), but the visual open/closed state does not — which is jarring mid-conversation.

This plan introduces:
1. **Auto-open on desktop by default.** On every desktop page load the chat panel is open, unless the visitor explicitly minimised it earlier in this tab.
2. **Minimize button** inside the chat panel header (collapses to launcher, keeps session intact). This is the only dismiss action — no separate "close".
3. **Menu (kebab) button** in the header that contains the existing **End Chat** action. The header now exposes two controls: `Menu (⋮)` and `Minimize (—)`.
4. **Persistent state across host-page navigations** (per-tab via `sessionStorage`) on **desktop only**. On mobile, every page navigation resets the panel to minimised (auto-open is intrusive on small screens).

## Problem Statement / Motivation

**User-reported friction:** "It's better to always open the chat and have a minimize button to minimize it to or to close it. so this is important when people move between pages and the chat window needs to be open."

Concrete failure mode:
- Visitor lands on host page A → teaser appears → visitor opens chat → starts a session.
- Visitor clicks a host-site nav link to page B → host page reloads → `embed.js` re-initialises → chat panel is **closed**.
- The conversation is intact in localStorage, but the visitor has to re-open the launcher to see it. Many won't, and the lead drops off.

Secondary issue: the launcher button (`btn`) currently *is* the close affordance — clicking it while open closes the chat. There is no in-panel minimize/close. Visitors expect a familiar header X/— pattern (same as Intercom, Drift, HubSpot chat).

## Proposed Solution

Two states, persisted per-tab on desktop only:

```
states: 'open' | 'minimized'
storage key: 'aq_widget_state'  (sessionStorage, per-tab, per-host-origin)
```

- **`open`** — iframe visible, launcher shows minimize icon.
- **`minimized`** — iframe hidden, launcher shows chat icon.

Default on `embed.js` boot:
1. **Mobile (`<768px`)** → always boot to `'minimized'`. Ignore any stored state. (Auto-open would cover the page; not acceptable.)
2. **Desktop**, `aq_widget_state === 'minimized'` → boot to `'minimized'` (visitor explicitly chose this earlier in the tab; respect it).
3. **Desktop**, otherwise (no stored state, or stored as `'open'`) → boot to `'open'`. This is the headline behaviour — the chat is open by default and stays open across navigation.

In-panel controls — the chat header gets two buttons next to the existing layout:
- **Menu (⋮)** — opens a small dropdown containing **End Chat** (the existing destructive reset). Future home for other meta-actions (transcript download, etc.).
- **Minimize (—)** — collapses the panel to the launcher.

The current standalone End Chat button is **moved inside the Menu** rather than removed; behaviour is unchanged. There is no separate "close" button — minimize is the only collapse action.

Cross-document signalling: the chat panel lives in an iframe on a different origin from the host page. The minimize button sits *inside* the iframe and must tell the host-page launcher to collapse. Use `window.parent.postMessage({ source: 'aq-chat', type: 'minimize' }, '*')` — embed.js listens, validates `source`, and updates state.

## Technical Considerations

- **Origin isolation:** the iframe is cross-origin to the host. Direct DOM access from inside the widget to `embed.js` is not possible. `postMessage` is the only safe channel. Validate the message envelope strictly (`event.data?.source === 'aq-chat'`) and treat anything else as untrusted — the host page may have its own postMessage listeners.
- **Storage scope:** `sessionStorage` is per-tab and per-origin (host origin for the launcher state, chatbot origin for the conversation). Open-state persistence applies only within a tab; opening the host site in a new tab gets a fresh boot.
- **Returning-visitor heuristic:** "session exists in localStorage" lives on the chatbot origin, so the *host page* can't see it directly. Two options:
  - **(A)** Have the iframe `postMessage` its session-presence on load; embed.js initialises to `minimized` then upgrades to `open` if a session is found. Slight flicker.
  - **(B)** Use a separate cookie on the chatbot origin (`SameSite=None; Secure`) read via a quick `fetch('/api/widget/session-status')` from embed.js. More predictable, costs one network hop.
  - Recommend **(A)** for simplicity; the flicker is one frame and `prefers-reduced-motion` is respected.
- **Mobile:** "always open" on mobile is intrusive — covers the page. Restrict the auto-open default to desktop (`min-width: 768px`); mobile keeps existing closed-by-default behaviour. Already-open state still persists across nav on mobile (so a visitor who explicitly opens it stays open on the next page).
- **Two surfaces stay in sync:** `public/embed.js` (vanilla, served to host sites) and `src/app/demo/chat-widget-embed.tsx` (React, used by `/demo`). Every change must land in both — they have drifted before.
- **Existing teaser rules:** `aq_teaser_shown` continues to gate the teaser; the new "Close" action sets it. Auto-open via session presence does **not** show the teaser (chat is already visible).
- **A11y:** new buttons need `aria-label="Minimize chat"` / `aria-label="Close chat"`. When minimised/closed, focus should return to the launcher button.
- **Race on rapid nav:** a host site that swaps `<body>` (some SPAs) doesn't reload `embed.js`. Auto-init guard already exists (script-tag idempotency); confirm it survives. Out of scope if not already handled.

## Acceptance Criteria

- [x] **Desktop first visit, no `aq_widget_state`** → panel boots open, no teaser (teaser logic effectively retires on desktop).
- [x] **Desktop subsequent navigation, no minimise yet** → panel stays open seamlessly; no flash of launcher between pages.
- [x] Visitor clicks the in-panel **Minimize (—)** button → panel collapses to launcher, `aq_widget_state` is `'minimized'`.
- [x] Visitor clicks launcher again → panel opens with full conversation history (proves no state was wiped).
- [x] Visitor navigates to a new page after minimising → panel stays minimised on desktop (respects the explicit choice).
- [x] Visitor clicks the **Menu (⋮)** button → a small dropdown opens with one action: **End Chat**. Clicking it triggers the existing End-Chat dialog. Pressing `Esc` or clicking outside closes the menu. Focus returns to the Menu button on close.
- [x] **Mobile (`<768px`) on every page load** → panel is minimised, regardless of `aq_widget_state`. Existing teaser behaviour preserved on mobile.
- [x] On mobile, visitor opens the panel → panel opens for that page only. After navigation, panel is minimised again on the next page.
- [x] Cross-origin postMessage handler ignores any message whose `data.source !== 'aq-chat'`.
- [x] Both surfaces updated in lockstep: `public/embed.js` and `src/app/demo/chat-widget-embed.tsx`.
- [x] Analytics events: `chat_minimized` emitted on minimise; `chat_opened` emits `source: 'auto'` for the desktop default-open and `source: 'launcher'` for an explicit launcher click; `chat_menu_opened` emitted on menu open.
- [x] `npm run lint` and `npm run build` pass.

## Success Metrics

- Drop in `chat_closed` → `chat_opened` round-trips per session (visitors no longer have to re-open after every navigation).
- Increase in average messages per session (proxy for completed conversations).
- No spike in `teaser_shown` events per unique visitor (confirms close button silences correctly).

## Dependencies & Risks

**Dependencies**
- None new. Uses existing `sessionStorage`, `postMessage`, and `lucide-react` icons (`Minus`, `X`).

**Risks**
- **Flicker on returning-visitor auto-open**: iframe loads → reports session presence → embed.js promotes from `minimized` to `open`. Mitigation: render iframe `display:none` initially, only promote after the message arrives, and apply `transition: opacity 150ms` so the swap is soft.
- **Host-site CSP**: some host sites set `frame-ancestors` or restrict `postMessage`. Existing iframe already loads, so frame-ancestors is fine. postMessage to `'*'` is acceptable here because the message contains no sensitive data; receiver-side origin check handles security.
- **Visitor confusion between Minimize, Close, and End Chat**: three dismiss-like actions in one header is busy. Mitigation: End Chat moves to a kebab menu or stays as-is but with clearer labelling (`End conversation` vs `Minimize` vs `Close`). Keep End Chat as today initially; revisit if user testing flags it.
- **Drift between `embed.js` and `chat-widget-embed.tsx`**: both must change. Add a checklist comment at the top of each file referencing the other. Add a `/demo` smoke test as part of the verification step.

## References & Research

### Internal references
- [public/embed.js:26](public/embed.js:26) — current iframe boot, closed by default.
- [public/embed.js:47](public/embed.js:47) — `openChat` / `closeChat` (launcher-driven only).
- [src/app/demo/chat-widget-embed.tsx:14](src/app/demo/chat-widget-embed.tsx:14) — React mirror with same closed-by-default behaviour.
- [src/components/chat/chat-widget.tsx:355](src/components/chat/chat-widget.tsx:355) — ChatWidget header where minimize/close buttons will mount.
- [src/components/chat/end-chat-button.tsx](src/components/chat/end-chat-button.tsx) — existing destructive control; new buttons sit alongside.
- [src/lib/chat-persistence.ts](src/lib/chat-persistence.ts) — `loadChat` / `saveChat` (chatbot-origin localStorage; informs the "session exists" probe).
- Brainstorm precedent: [docs/brainstorms/2026-04-29-chat-teaser-nudge-brainstorm.md](docs/brainstorms/2026-04-29-chat-teaser-nudge-brainstorm.md) and resulting plan [docs/plans/2026-04-29-feat-chat-teaser-nudge-plan.md](docs/plans/2026-04-29-feat-chat-teaser-nudge-plan.md) — established the teaser/launcher pattern this plan extends.

### Conventions (from CLAUDE.md / AGENTS.md)
- Lucide React icons (`Minus`, `X` — both already in `lucide-react`).
- Tailwind v4 with `brand` color token; existing `focus-visible:ring-brand/40` pattern.
- `@/` path alias for imports.
- Vercel AI SDK v6 — chat session lifecycle untouched by this change.

## Implementation Sketch (pseudo-code)

### `public/embed.js`

```js
// public/embed.js
var STATE_KEY = 'aq_widget_state'; // 'open' | 'minimized' | 'closed'

function readState() {
  try { return sessionStorage.getItem(STATE_KEY); } catch { return null; }
}
function writeState(s) {
  try { sessionStorage.setItem(STATE_KEY, s); } catch { /* noop */ }
}

function applyState(s) {
  if (s === 'open') { frame.style.display = 'block'; btn.innerHTML = '✕'; btn.setAttribute('aria-label','Close chat'); }
  else { frame.style.display = 'none'; btn.innerHTML = '💬'; btn.setAttribute('aria-label','Open chat'); }
}

// On boot:
var stored = readState();
if (stored) {
  applyState(stored);
} else {
  // Probe iframe for an existing session (desktop only).
  applyState('minimized');
  // iframe will postMessage {source:'aq-chat', type:'session-status', hasSession:true} on load
}

// Listen for messages from the iframe
window.addEventListener('message', function (event) {
  var data = event.data;
  if (!data || data.source !== 'aq-chat') return;
  if (data.type === 'minimize') { writeState('minimized'); applyState('minimized'); trackEvent('chat_minimized'); }
  if (data.type === 'close')    { writeState('closed');    applyState('closed');    dismissTeaser(); trackEvent('chat_closed_panel'); }
  if (data.type === 'session-status' && data.hasSession && isDesktop && !stored) {
    writeState('open'); applyState('open'); trackEvent('chat_opened', { source: 'persisted' });
  }
});
```

### `src/components/chat/chat-widget.tsx` (header additions)

```tsx
// pseudo
import { Minus, X } from "lucide-react";

function notifyParent(type: "minimize" | "close") {
  if (typeof window === "undefined") return;
  if (window.parent === window) return; // not embedded
  window.parent.postMessage({ source: "aq-chat", type }, "*");
}

// Inside header JSX, alongside EndChatButton:
<button onClick={() => notifyParent("minimize")} aria-label="Minimize chat" className="...">
  <Minus className="h-5 w-5" />
</button>
<button onClick={() => notifyParent("close")} aria-label="Close chat" className="...">
  <X className="h-5 w-5" />
</button>
```

### `src/components/chat/chat-widget.tsx` (session-status announce on mount)

```tsx
useEffect(() => {
  if (window.parent === window) return;
  const hasSession = persisted.initialMessages.length > 0;
  window.parent.postMessage(
    { source: "aq-chat", type: "session-status", hasSession },
    "*"
  );
}, []);
```

### `src/app/demo/chat-widget-embed.tsx` (mirror)

Same state machine, but in React state — since this surface mounts the React `ChatWidget` directly (no cross-origin iframe), the `postMessage` round-trip is replaced by props/callbacks. Auto-open on session presence reads `loadChat()` directly.

## Out of Scope

- Resizing or repositioning the chat panel.
- Persisting state across **tabs** (would require localStorage; explicitly want per-tab today).
- Reworking the End Chat / kebab-menu hierarchy (note as a follow-up if user testing shows confusion).
- Mobile bottom-sheet redesign — separate plan.
- Server-side cookie-based session probe (Option B above) — keep client-only for now.

## Decisions (resolved 2026-05-05)

1. **Auto-open on desktop is the default.** No teaser-first dance.
2. **No close button.** Minimize is the only collapse action. End Chat moves into a Menu (⋮) dropdown in the header.
3. **Mobile resets to minimized on every navigation.** Auto-open is desktop-only.
