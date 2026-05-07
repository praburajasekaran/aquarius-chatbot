---
title: Rename chatbot avatar to "Ask Banjo" (non-binary persona)
type: feat
date: 2026-05-07
---

# Rename chatbot avatar to "Ask Banjo" (non-binary persona)

Rebrand the chatbot avatar from "Aquarius Lawyers Criminal Law Assistant" to "Aquarius Lawyers Ask Banjo". Banjo is a named non-binary persona (they/them) — not just a label swap. The header subtitle, page title, accessibility labels, and the assistant's self-identity in the system prompt all need to reflect the new name and pronouns.

## Acceptance Criteria

- [x] Header subtitle under the firm name reads `Ask Banjo` (was `Criminal Law Assistant`)
- [x] Page `<title>` reads `Aquarius Lawyers — Ask Banjo` (driven by `BRANDING.pageTitle`)
- [x] Chat container `aria-label` reads `Ask Banjo chat` (was hard-coded `Criminal Law Assistant chat`)
- [x] System prompt establishes Banjo as a named persona with they/them pronouns; the assistant refers to itself as Banjo when asked who/what it is
- [x] `.env.example` shows `NEXT_PUBLIC_FIRM_TAGLINE=Ask Banjo`
- [x] `npm run lint` and `npm run build` pass
- [x] Manual smoke: open the demo page, header shows "Aquarius Lawyers / Ask Banjo"; ask "what's your name?" — assistant answers "Banjo" and uses they/them when referring to itself

## Context

Branding is centralized in [src/lib/branding.ts](src/lib/branding.ts). The header reads `firmName` + `tagline`, and `pageTitle` composes them. Most call sites already pull from `BRANDING`, so updating the tagline default cascades correctly to:

- Page metadata via `BRANDING.pageTitle` ([layout.tsx:20](src/app/layout.tsx:20))
- Header subtitle in the chat widget at [chat-widget.tsx:558](src/components/chat/chat-widget.tsx:558)
- The assistant's self-identity in the system prompt at [system-prompt.ts:3](src/lib/system-prompt.ts:3) (currently `"You are the ${BRANDING.firmName} ${BRANDING.tagline}."` → resolves to `"You are the Aquarius Lawyers Ask Banjo."`)

Two places hard-code the old string and need direct edits:
- [chat-widget.tsx:548](src/components/chat/chat-widget.tsx:548) — `aria-label="Criminal Law Assistant chat"`
- [.env.example:131](.env.example:131) — `NEXT_PUBLIC_FIRM_TAGLINE=Criminal Law Assistant`

The system prompt currently just slots the tagline into a sentence — it has no persona definition (no name, no pronouns). Because Banjo is meant to read as a *character*, we need a small persona block so the assistant identifies as Banjo and uses they/them. Today the system prompt's `## YOUR PERSONA` section ([system-prompt.ts:5-14](src/lib/system-prompt.ts:5)) describes tone but not identity.

Production override: if `NEXT_PUBLIC_FIRM_TAGLINE` is set in the deployed environment (Vercel) it will win over the new default. The deploy environment must be updated too — flag this in the PR description.

### Non-goals (out of scope)

- Adding a Banjo avatar image / illustration. Header keeps the existing logo; only text changes.
- Changing the `emailSenderName` ("Law Assistant") on outbound email — leave as-is for now; it's a separate decision because of email deliverability/From-name implications.
- Updating the welcome message copy (`welcomeMessage` / `welcomeShort` in branding.ts). The current copy doesn't reference "Criminal Law Assistant" by name, so it still reads naturally.
- Updating historical plan docs in `docs/plans/` and `docs/superpowers/plans/` that quote the old tagline — those are historical artifacts.

## MVP

### src/lib/branding.ts (line 3)

```ts
// before
tagline: process.env.NEXT_PUBLIC_FIRM_TAGLINE ?? "Criminal Law Assistant",

// after
tagline: process.env.NEXT_PUBLIC_FIRM_TAGLINE ?? "Ask Banjo",
```

### src/components/chat/chat-widget.tsx (line 548)

```tsx
// before
<div className="relative flex flex-col h-full bg-white" aria-label="Criminal Law Assistant chat">

// after — drive from BRANDING so it never drifts again
<div className="relative flex flex-col h-full bg-white" aria-label={`${BRANDING.tagline} chat`}>
```

(`BRANDING` is already imported in this file — used on line 556.)

### src/lib/system-prompt.ts (line 3 — replace opening sentence and add identity to persona block)

```ts
// before
export const systemPrompt = `You are the ${BRANDING.firmName} ${BRANDING.tagline}. You are the first point of contact for visitors to the ${BRANDING.firmName} website seeking help with criminal law matters. ...

// after
export const systemPrompt = `You are Banjo, the AI assistant at ${BRANDING.firmName}. You use they/them pronouns. You are the first point of contact for visitors to the ${BRANDING.firmName} website seeking help with criminal law matters. ...
```

Add one bullet to the `## YOUR PERSONA` section so identity questions are handled cleanly:

```
- If a visitor asks who or what you are, say you're Banjo, the AI assistant for Aquarius Lawyers. Use they/them when referring to yourself in the third person. Do not claim to be human.
```

### .env.example (line 131)

```
# before
NEXT_PUBLIC_FIRM_TAGLINE=Criminal Law Assistant

# after
NEXT_PUBLIC_FIRM_TAGLINE=Ask Banjo
```

### Deploy config (out of repo)

Update `NEXT_PUBLIC_FIRM_TAGLINE` in the Vercel project (and any other deployed envs) to `Ask Banjo`, otherwise the env override will keep the old text live. Note this in the PR description.

## Verification

- [x] `npm run lint`
- [x] `npm run build`
- [x] `npm run dev`, open the demo page, confirm header reads "Aquarius Lawyers" / "Ask Banjo"
- [x] Browser tab title reads `Aquarius Lawyers — Ask Banjo`
- [x] DevTools: chat container has `aria-label="Ask Banjo chat"`
- [x] Live chat: ask "what's your name?" / "are you a person?" — assistant identifies as Banjo and uses they/them, doesn't claim to be human
- [x] `grep -rn "Criminal Law Assistant" src/` returns no results

## References

- Branding source of truth: [src/lib/branding.ts](src/lib/branding.ts)
- Header rendering: [src/components/chat/chat-widget.tsx:548-560](src/components/chat/chat-widget.tsx:548)
- System prompt: [src/lib/system-prompt.ts:3](src/lib/system-prompt.ts:3)
- Page metadata: [src/app/layout.tsx:20](src/app/layout.tsx:20)
- Env example: [.env.example:131](.env.example:131)
- Precedent rename plan (transcript label): [docs/plans/2026-05-05-refactor-rename-chatbot-label-to-al-bot-plan.md](docs/plans/2026-05-05-refactor-rename-chatbot-label-to-al-bot-plan.md)
