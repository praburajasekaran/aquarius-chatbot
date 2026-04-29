---
date: 2026-04-29
topic: chat-teaser-nudge
---

# Chat Teaser Nudge

## What We're Building

A subtle teaser bubble that appears next to the floating chat launcher to make
the chatbot impossible to miss without auto-opening the full chat window. On
desktop, ~3 seconds after page load, a small speech-bubble shows the line
**"Need legal help? Ask me anything →"** beside the existing brand-coloured
launcher button. The teaser is dismissable (small ×), shows once per session,
and is suppressed entirely on mobile so it doesn't crowd small screens.

## Why This Approach

We considered four directions: (a) auto-opening the full chat on load, (b) a
delayed open, (c) scroll/exit-intent triggers, and (d) a teaser nudge. Auto-open
hurts mobile UX, feels pushy, and degrades Core Web Vitals. The teaser nudge
catches the eye with the same effect (visitors see the chatbot) at a fraction
of the intrusion cost. Once-per-session persistence respects returning visitors
without nagging them across visits.

## Key Decisions

- **Trigger**: 3-second delay after mount (desktop only) — long enough for the
  page to settle, short enough that the visitor sees it before deciding to leave.
- **Copy**: "Need legal help? Ask me anything →" — single friendly line, matches
  the warm tone of the existing welcome chips.
- **Persistence**: `sessionStorage` flag (`aq_teaser_shown`). Dismissed teaser or
  opening the chat both flip the flag so it doesn't reappear that session.
- **Device gating**: desktop only (≥768px or pointer:fine). Mobile keeps just
  the bubble launcher to preserve thumb-zone real estate.
- **Location**: extend `src/app/demo/chat-widget-embed.tsx` — keep the teaser
  co-located with the launcher rather than splitting concerns.
- **Dismissal**: small × on the teaser; clicking the teaser body opens the chat.
- **Animation**: gentle fade + slight slide-up on appear, fade-out on dismiss.
- **Accessibility**: `role="status"` so screen readers announce it once;
  dismiss button has `aria-label`.

## Open Questions

- None blocking. Copy can be A/B tested later if conversion data warrants it.

## Next Steps

→ `/workflows:plan` for implementation details
