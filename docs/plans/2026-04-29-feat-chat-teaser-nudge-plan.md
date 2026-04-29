---
title: Chat Teaser Nudge
type: feat
date: 2026-04-29
brainstorm: docs/brainstorms/2026-04-29-chat-teaser-nudge-brainstorm.md
---

# ✨ Chat Teaser Nudge

> **Implementer contract — read this section before writing any code.**
> This plan describes ONE isolated feature. The "Implementation Scope"
> section below is binding. The deeper sections after it provide context
> and rationale, not extra work.

---

## Implementation Scope

### 1. Feature summary

Add a once-per-session, desktop-only teaser bubble next to the floating chat
launcher that displays "Need legal help? Ask me anything →" three seconds
after page load, so visitors notice the chatbot without it auto-opening.
Ship the same behaviour on **both** distribution surfaces: the in-app React
component used on the demo page, and the vanilla-JS `embed.js` script used
by third-party sites.

### 2. Exact list of files to be modified

Only these files may be changed. Any other change is out of scope and
requires a STOP-and-ask.

- [src/app/demo/chat-widget-embed.tsx](src/app/demo/chat-widget-embed.tsx)
- [public/embed.js](public/embed.js)

That's it. Two files. No new files. No package.json. No config. No CSS file
edits (the React version uses Tailwind utility classes inline; the vanilla
version uses inline styles, matching the existing embed.js style).

### 3. Step-by-step implementation plan (ordered)

**Phase A — React component** ([chat-widget-embed.tsx](src/app/demo/chat-widget-embed.tsx))

1. Add a `teaserVisible: boolean` state alongside the existing `open` and
   `mounted` state.
2. Extend the existing mount `useEffect` (the one that sets `mounted = true`)
   to also: (a) read `sessionStorage.getItem("aq_teaser_shown")` inside
   try/catch, (b) if not `"1"`, schedule `setTimeout(() => setTeaserVisible(true), 3000)`,
   (c) return a cleanup function that clears the timeout.
3. Add a `dismissTeaser()` function that sets `teaserVisible=false` and writes
   `"1"` to `sessionStorage["aq_teaser_shown"]` inside try/catch.
4. Add an `openChat()` function that calls `setOpen(true)` and `dismissTeaser()`.
5. Replace the existing launcher button's inline `onClick={() => setOpen((o) => !o)}`
   with a handler that opens via `openChat()` when closed and just closes when
   open (preserves the existing toggle UX, plus dismisses teaser on first open).
6. Add a teaser JSX block between the existing iframe panel `<div>` and the
   launcher `<button>`, positioned `bottom-7 right-24`, gated by
   `hidden md:flex` so it never renders on mobile, with the visible state
   gated by `teaserVisible && !open`. Use the same transition vocabulary as
   the iframe panel (`transition-all duration-300`, `opacity-0/100`,
   `translate-y-1/0`) plus `motion-reduce:transition-none`.
7. Inside the teaser: a body `<button type="button">` with the copy and
   `onClick={openChat}`, and a dismiss `<button type="button">` (× icon) with
   `aria-label="Dismiss chat teaser"` and `onClick={(e) => { e.stopPropagation(); dismissTeaser(); }}`.
8. Container gets `role="status"` and `aria-live="polite"`; `aria-hidden`
   mirrors the visible boolean so SR doesn't announce the hidden state.

**Phase B — Vanilla embed script** ([embed.js](public/embed.js))

9. Change the iframe's initial `display:block` to `display:none` and the
   button's initial `innerHTML` from `'✕'` to `'💬'`. (This corrects the
   current auto-open default, which contradicts the feature's intent.)
10. Move the toggle handler to a small `openChat()` / `closeChat()` pair so
    the teaser body click and launcher click can share the open path.
11. Add a `dismissTeaser()` function that hides the teaser DOM node and writes
    `sessionStorage["aq_teaser_shown"] = "1"` inside try/catch.
12. On IIFE startup, after appending the launcher button, check
    `window.matchMedia('(min-width: 768px)').matches`. If false, do not
    create the teaser at all (mobile is excluded).
13. If desktop, check `sessionStorage.getItem("aq_teaser_shown")` inside
    try/catch. If already `"1"`, do not create the teaser.
14. Otherwise: create a teaser `<div>` with inline styles that visually
    match the React version (white card, rounded corners, soft shadow,
    same copy, dismiss × inside). Position `fixed; bottom:28px; right:96px;
    z-index:9998` to sit beside the launcher.
15. Set the teaser's initial `opacity:0; transform:translateY(4px)` and
    schedule a `setTimeout(() => { /* swap to opacity:1; transform:none */ }, 3000)`
    plus a CSS transition for a fade-in. Respect reduced motion via
    `window.matchMedia('(prefers-reduced-motion: reduce)').matches`.
16. Wire the teaser body click to `openChat()` + `dismissTeaser()`. Wire the
    × click to `dismissTeaser()` only, with `event.stopPropagation()` so it
    doesn't bubble to the body click.
17. Make the launcher's existing onClick also call `dismissTeaser()` on first
    open (so the launcher click path matches the React version).

### 4. Assumptions and edge cases

**Assumptions**

- `sessionStorage` is the right scope: per-tab, per-visit. Closing the tab
  resets the flag. (Confirmed in brainstorm.)
- The `embed.js` IIFE will run after `document.body` exists. Existing code
  already assumes this and appends to `document.body`; we keep that
  assumption.
- The 768px desktop breakpoint matches Tailwind's `md:` and is acceptable
  for the vanilla version too. Hybrid devices (touch laptops) get the teaser
  — acceptable trade-off for simplicity over `(pointer:fine)`.
- `embed.js` is unminified and inline-styled today; we keep that convention
  rather than introducing a build step.

**Edge cases handled**

- **SSR / hydration (React)**: `sessionStorage` only touched inside `useEffect`;
  existing `mounted` gate already returns `null` during SSR.
- **Unmount before 3s (React)**: cleanup function clears the timeout.
- **Visitor opens chat before 3s elapses**: `openChat()` flips `open=true` and
  dismisses the teaser; pending timer's eventual fire still produces correct
  state (`teaserVisible && !open` = false).
- **Storage quota / Safari private mode**: try/catch around every
  `sessionStorage` read and write. Worst case: teaser shows every visit.
- **`prefers-reduced-motion`**: React uses `motion-reduce:transition-none`;
  vanilla checks `matchMedia` and applies `transition: none`.
- **Click bubbling on dismiss × inside teaser body**: explicit
  `e.stopPropagation()` in both versions so × never opens the chat.
- **Keyboard nav**: both controls are real `<button>` elements; project's
  AAA `:focus-visible` styles apply automatically (React). Vanilla matches
  by setting `outline` styles on focus (or accepts UA default — see Q in
  "Stop and ask").
- **Screen reader announcement**: React uses `role="status" aria-live="polite"`;
  vanilla mirrors with the same attributes on the teaser node.
- **Copy length at 768px**: ~33 char copy + padding fits in ~280–320px,
  with 96px right offset and 56px launcher; tested in plan, verify in QA.
- **`embed.js` cross-origin sessionStorage**: each host site has its own
  `sessionStorage`. The flag is scoped to the embedding site, not Aquarius.
  This is correct — a visitor browsing two different client sites should
  see the teaser on each, not have one site's dismissal carry over.

**Stop-and-ask conditions** (do NOT silently work around)

- If the teaser, at any planned position, visually overlaps the launcher
  on a real test viewport.
- If `embed.js` consumers rely on the iframe being open by default (the
  brainstorm-approved fix is to close-by-default; if a real consumer needs
  open-by-default, that's a config option discussion, not a silent override).
- If a typecheck or lint failure suggests deeper restructuring is needed.

### 5. What will NOT be changed (explicit non-goals)

- ❌ The chat itself ([chat-widget.tsx](src/components/chat/chat-widget.tsx),
  [message-list.tsx](src/components/chat/message-list.tsx),
  [message-input.tsx](src/components/chat/message-input.tsx),
  [disclaimer-banner.tsx](src/components/chat/disclaimer-banner.tsx)) — no
  edits.
- ❌ The demo landing page ([demo/page.tsx](src/app/demo/page.tsx)) — the
  `<ChatWidgetEmbed src="/" />` integration line stays exactly as is.
- ❌ Server tools, AI SDK config, system prompts, intake logic, knowledge
  base — none of it.
- ❌ Tailwind config, [globals.css](src/app/globals.css), font loading,
  brand tokens — no edits.
- ❌ `package.json`, `package-lock.json` — no new dependencies. (We already
  have `lucide-react`'s `X` icon imported in the React file; reuse it.)
- ❌ ESLint config, TypeScript config, Next.js config — untouched.
- ❌ Environment variables, `.env.*`, deployment config (Vercel, Netlify) —
  untouched.
- ❌ Tests, CI workflow files — no new test files added in this scope.
  Manual QA per "Acceptance Criteria" below.
- ❌ The `src/app/page.tsx` chat surface (the iframe target itself) — no
  edits; the teaser lives outside the iframe.
- ❌ Analytics or instrumentation — captured as future work, not this PR.
- ❌ Renaming, reformatting, or "while-I'm-here" cleanup of the two files
  being edited — only the lines required for the feature change.
- ❌ Adding a build step for `embed.js` — it stays as a single hand-written
  IIFE.
- ❌ Adding a teaser tail/pointer triangle — deferred per brainstorm.

---

## Overview

Add a small teaser speech bubble next to the floating chat launcher so first-
time desktop visitors notice the chatbot without being interrupted by an auto-
opening modal. The teaser appears ~3 seconds after page load, displays the
line **"Need legal help? Ask me anything →"**, is dismissable with a small ×,
and shows once per session. Mobile is intentionally excluded to preserve
thumb-zone real estate. The behaviour ships on **two surfaces**:

1. The in-app React component [chat-widget-embed.tsx](src/app/demo/chat-widget-embed.tsx)
   used on the Aquarius demo page.
2. The vanilla-JS [embed.js](public/embed.js) script that third-party sites
   load via `<script src="…/embed.js">`.

While porting, we also fix a pre-existing bug in `embed.js`: the iframe
currently has `display:block` at construction time and the button starts with
`'✕'`, which means the chat auto-opens on every page load — exactly the
behaviour the brainstorm rejected. Closing it by default is part of this
feature.

## Problem Statement / Motivation

Visitors land on the demo page (or a third-party site embedding the chatbot)
and miss the chatbot — the floating launcher in the bottom right is easy to
overlook. Auto-opening the full chat (which `embed.js` accidentally does
today) introduces the costs we explicitly want to avoid: it feels intrusive,
gets reflexively dismissed, hurts mobile UX, and degrades Core Web Vitals.
A subtle teaser nudge accomplishes the same discovery goal at a fraction of
the cost: visitors notice the chatbot via a single short line of text without
losing control of their viewport.

## Proposed Solution

Two parallel implementations of the same behaviour, each idiomatic to its
surface:

**React surface** — extend [chat-widget-embed.tsx](src/app/demo/chat-widget-embed.tsx)
with `teaserVisible` state, a 3s mount-effect timer, sessionStorage-backed
dismissal, and a Tailwind-styled teaser block gated by `hidden md:flex`.

**Vanilla surface** — extend [embed.js](public/embed.js) with a
`matchMedia('(min-width: 768px)')` desktop gate, sessionStorage check,
inline-styled teaser DOM node, and `setTimeout` fade-in. Also flip the
iframe's initial `display` to `none` and the button's initial glyph to `💬`
so the chat no longer auto-opens.

Both surfaces use the same flag key (`aq_teaser_shown`), the same copy, the
same 3-second delay, the same desktop-only gate. They do NOT share code —
each is self-contained for its environment, which is simpler than abstracting
a shared module given the small surface area.

## Technical Approach

### React component

Single client component, single state machine. The existing component already
manages `open` and `mounted`. We add `teaserVisible`. Three actions hide the
teaser and persist the flag:

1. User clicks the dismiss × on the teaser → `dismissTeaser()`
2. User clicks the teaser body → `openChat()` (which calls `dismissTeaser()`)
3. User clicks the existing launcher → `openChat()` on the open path

```ts
function dismissTeaser() {
  setTeaserVisible(false);
  try { sessionStorage.setItem("aq_teaser_shown", "1"); } catch {}
}
```

Teaser JSX (sketch):

```tsx
<div
  role="status"
  aria-live="polite"
  aria-hidden={!(teaserVisible && !open)}
  className={`hidden md:flex fixed bottom-7 right-24 z-[9998]
              transition-all duration-300 motion-reduce:transition-none
              ${teaserVisible && !open
                ? "opacity-100 translate-y-0 pointer-events-auto"
                : "opacity-0 translate-y-1 pointer-events-none"}`}
>
  <button type="button" onClick={openChat} className="…teaser body styles…">
    Need legal help? Ask me anything <span aria-hidden>→</span>
  </button>
  <button type="button"
          onClick={(e) => { e.stopPropagation(); dismissTeaser(); }}
          aria-label="Dismiss chat teaser"
          className="…dismiss styles…">
    <X className="h-3 w-3" strokeWidth={2.5} />
  </button>
</div>
```

### Vanilla embed script

Approximate shape (final code written during execution, not now):

```js
(function() {
  // existing iframe + button creation, with these adjustments:
  //   frame.style.display = 'none';                 // closed by default
  //   btn.innerHTML = '💬';                          // matches closed state

  function openChat()    { frame.style.display = 'block'; btn.innerHTML = '✕'; dismissTeaser(); }
  function closeChat()   { frame.style.display = 'none';  btn.innerHTML = '💬'; }
  function dismissTeaser() {
    if (teaser) teaser.style.display = 'none';
    try { sessionStorage.setItem('aq_teaser_shown', '1'); } catch (e) {}
  }
  btn.onclick = function() {
    if (frame.style.display === 'none') openChat(); else closeChat();
  };

  // Teaser — desktop only, once per session
  var isDesktop = window.matchMedia('(min-width: 768px)').matches;
  var alreadyShown = false;
  try { alreadyShown = sessionStorage.getItem('aq_teaser_shown') === '1'; } catch (e) {}

  var teaser = null;
  if (isDesktop && !alreadyShown) {
    teaser = document.createElement('div');
    teaser.setAttribute('role', 'status');
    teaser.setAttribute('aria-live', 'polite');
    teaser.style.cssText = /* white card, fixed bottom:28px right:96px,
                              opacity:0, transform:translateY(4px), transition */;
    teaser.innerHTML = /* body button + dismiss × button */;
    // attach click handlers via addEventListener (not innerHTML onclick)
    document.body.appendChild(teaser);

    setTimeout(function() {
      teaser.style.opacity = '1';
      teaser.style.transform = 'translateY(0)';
    }, 3000);
  }
})();
```

Inline styles in `embed.js` mirror the React Tailwind classes:
- White background, ~12–16px padding, 12–16px border-radius
- Soft shadow: `0 8px 24px rgba(0,0,0,0.12)`
- Subtle ring: `box-shadow: 0 0 0 1px rgba(0,0,0,0.05), …` combined
- 14px text, neutral dark gray
- Reduced-motion: skip the transition entirely

### Persistence semantics (both surfaces)

| Event | `aq_teaser_shown` | Teaser visible | Notes |
|-------|-------------------|----------------|-------|
| Page load, flag unset | `"1"` after dismiss/open | true after 3s | First-time path |
| Page load, flag set | unchanged | false | Returning within session |
| Click teaser body | `"1"` | false | Also opens chat |
| Click dismiss × | `"1"` | false | Stays closed |
| Click launcher | `"1"` | false | Same as teaser body for flag |
| New tab / next visit | flag absent | will show again | By design |

## Acceptance Criteria

### Functional — React surface

- [x] On a fresh session, the demo page shows nothing teaser-related for the
      first ~3 seconds.
- [x] After ~3 seconds (≥768px viewport only), a white teaser fades in to the
      left of the launcher with the copy *"Need legal help? Ask me anything →"*.
- [x] Clicking the teaser body opens the chat and hides the teaser.
- [x] Clicking the dismiss × hides the teaser without opening the chat.
- [x] Clicking the launcher hides the teaser and opens the chat.
- [x] On `<768px` viewport, the teaser never renders.
- [x] After any of the three dismissal paths, reloading the page in the same
      tab does NOT re-show the teaser.
- [x] Opening the page in a new tab (new session) shows the teaser again.

### Functional — Vanilla `embed.js` surface

- [x] On a fresh session, an external page loading `embed.js` shows the
      launcher button (💬 glyph) and **no auto-opened chat**.
- [x] After ~3 seconds on desktop (≥768px), the teaser appears beside the
      launcher with the same copy.
- [x] Clicking the teaser body opens the iframe and hides the teaser.
- [ ] Clicking the dismiss × hides the teaser without opening the iframe.
- [x] Clicking the launcher hides the teaser and opens the iframe; clicking
      again closes the iframe.
- [x] On `<768px` viewport, the teaser is never created (no DOM node added).
- [ ] sessionStorage flag scoped to the embedding host (verified by checking
      different hosts behave independently).

### Non-functional

- [ ] No hydration mismatch warnings (React).
- [ ] No console errors when `sessionStorage` throws (test via private window
      or property mock).
- [ ] Both surfaces respect `prefers-reduced-motion` (no slide; instant
      appearance).
- [ ] Both teaser body and × are keyboard-focusable; React inherits AAA
      focus ring; vanilla uses default UA focus ring (acceptable since
      embed.js consumers may have their own UA defaults).
- [ ] Screen reader announces the teaser text once on appear (NVDA/VoiceOver).
- [ ] No regression in Lighthouse score on the demo page.
- [ ] `embed.js` size stays small (under ~2KB unminified).

### Quality gates

- [ ] `npm run lint` passes.
- [ ] `npm run build` passes.
- [ ] Manual QA pass: Chrome desktop, Safari desktop, Chrome mobile (no teaser),
      reduced-motion session, `embed.js` loaded into a throwaway static HTML
      file via `python3 -m http.server` or similar.

## Files Changed

| Path | Change |
|------|--------|
| [src/app/demo/chat-widget-embed.tsx](src/app/demo/chat-widget-embed.tsx) | Add `teaserVisible` state, mount-effect timer, dismiss handler, `openChat()`, teaser JSX block. |
| [public/embed.js](public/embed.js) | Flip default to closed; add `openChat`/`closeChat`/`dismissTeaser`; add desktop+session-gated teaser DOM with 3s fade-in. |

No new files. No package changes. No env vars. No CSS file edits.

## Success Metrics

- **Discovery rate** — % of sessions on the demo page (and `embed.js`-hosting
  sites) that result in chat being opened. Target +20% week-over-week after
  ship (instrumentation deferred to follow-up).
- **Dismissal rate** — % of teaser-shown sessions that explicitly click ×.
  >40% suggests revisiting copy/timing.
- **Bounce-time correlation** — sessions where teaser appeared and visitor
  stayed > 30s post-appearance.

## Dependencies & Risks

- **Risk: brand drift in `embed.js`** — vanilla styles must visually echo
  the React version. Mitigation: side-by-side QA before merge.
- **Risk: behaviour change for `embed.js` consumers** — closing-by-default
  is a deliberate behaviour change. Any third-party site that today expects
  the chat to be open on load will see different behaviour. We accept this
  because it aligns with the brainstorm decision and matches the React
  version. Communicate via release notes.
- **Risk: A/B tuning** — keep copy and timing in named constants/variables
  so a follow-up A/B test can swap them without re-architecting.
- **Dependency: none** — pure client-side, no API changes, no migrations.

## Alternatives Considered

- **Auto-open the full chat** — rejected during brainstorming.
- **Exit-intent trigger** — could layer on later if dismissal rate is high.
- **Bouncing/pulsing launcher** — conveys no value; teaser communicates intent.
- **Shared module between React and vanilla** — rejected as overengineering
  for ~30 lines of logic per side. Each surface stays self-contained.
- **Replace `embed.js` with a bundled Preact/lit widget** — bigger blast
  radius, requires a build step. Defer until there's another reason to
  unify.

## Future Considerations

- Move copy + timing to a `WIDGET_CONFIG` constant for A/B testing.
- Add a tail/pointer to the teaser if user feedback says the connection to
  the launcher isn't visually obvious.
- Mobile-specific teaser layout (e.g., full-width above launcher) once
  mobile copy is decided.
- Analytics events: `teaser_shown`, `teaser_clicked`, `teaser_dismissed`.
- Consider a single bundled widget that supersedes `embed.js` once the
  inline-script approach hits its limits.

## Documentation Plan

- No README/AGENTS update required.
- Inline comments in both files documenting:
  - Once-per-session contract (and why `sessionStorage` not `localStorage`).
  - Why `sessionStorage` access is try/catch wrapped (Safari private mode).
  - Why `embed.js` now closes by default (behaviour change rationale).

## References & Research

### Internal

- Brainstorm: [2026-04-29-chat-teaser-nudge-brainstorm.md](docs/brainstorms/2026-04-29-chat-teaser-nudge-brainstorm.md)
- Existing widget: [chat-widget-embed.tsx](src/app/demo/chat-widget-embed.tsx)
- Existing embed script: [embed.js](public/embed.js)
- Demo integration: [demo/page.tsx](src/app/demo/page.tsx)
- Theme tokens / focus ring: [globals.css](src/app/globals.css)
- Project conventions: [CLAUDE.md](CLAUDE.md), [AGENTS.md](AGENTS.md)

### External

- WCAG 2.4.7 (focus visible), 1.4.11 (non-text contrast), 2.5.5 (target size).
- React 19 effect cleanup contract.

### Related Work

- [#33](https://github.com/praburajasekaran/aquarius-chatbot/pull/33) — lawyer
  photo as assistant avatar (warmth tone the teaser should match).
- [#32](https://github.com/praburajasekaran/aquarius-chatbot/pull/32) — input
  resize / scrollbar fix (recent UX polish in the same widget).
