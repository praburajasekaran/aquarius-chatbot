---
date: 2026-04-10
topic: phase1-scaffold
---

# Phase 1 Scaffold — Aquarius Lawyers AI Chatbot

## What We're Building

An AI-powered legal chatbot widget for the Aquarius Lawyers Criminal Law page. The chatbot answers firm-approved questions (text + voice input), collects client details, processes LSS fees via Stripe, accepts document uploads, books appointments via Calendly, creates leads/contacts/matters in Smokeball via Zapier, and emails a full transcript to the firm.

Phase 1 covers Criminal Law only. The architecture must be reusable for Phase 2 (four additional practice areas).

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Framework | Next.js (TypeScript) | Native Vercel deployment, API routes for integrations |
| Styling | Tailwind CSS | Rapid UI development, easy theming to match firm branding |
| Chat SDK | Vercel AI SDK (`ai` + `useChat`) | Built-in streaming, tool calling, multi-step flows |
| LLM | Gemini Flash | Cheap, fast, sufficient for intent matching against ~15 Q&A pairs |
| Payments | Stripe Checkout (embedded) | PCI-compliant, no card data on our servers |
| Booking | Calendly (embedded widget) | Direct embed for non-urgent appointment scheduling |
| Email | Resend | Free tier covers volume, simple API |
| Automation | Zapier | Smokeball lead/contact/matter creation + doc attachment |
| Session Store | Vercel KV (short TTL) | Temporary server-side state for payment/upload tracking, auto-deletes |
| Hosting | Vercel Pro | Serverless functions, edge network, commercial use |
| WordPress | Script tag embed | Isolated widget, minimal WordPress dependency |

## Why This Approach

- **Vercel AI SDK + Gemini Flash**: The chatbot only does semantic matching against a small approved Q&A list — no generative answers. Flash is 10-20x cheaper than frontier models and fast enough for real-time chat. The AI SDK's tool-calling pattern naturally models the multi-step visitor journey.
- **Vercel KV with TTL**: Server-side session state is needed to track Stripe webhook confirmations and file upload references before forwarding to Zapier/email. Short TTL (1 hour) ensures compliance with "chat data deleted at end of session."
- **Next.js on Vercel**: Zero-config deployment, API routes handle all server-side integration logic (Stripe, Zapier, Resend), and the widget can be exported as an embeddable script.

## Key Decisions

- **No generative AI for answers**: LLM used strictly for intent matching. System prompt constrains responses to approved Q&A pairs only.
- **Gemini Flash over frontier models**: Cost and speed prioritized — the matching task is simple.
- **Vercel KV over database**: Ephemeral session data only, no persistent storage needed. Compliant with privacy requirements.
- **Script embed over iframe**: Better UX integration with the WordPress page while maintaining isolation.
- **Tool-calling for conversation flow**: Each step (collect details, payment, upload, booking) modeled as an AI SDK tool — clean separation of concerns.

## Conversation Flow (Tool-Calling Model)

1. `matchQuestion` — matches visitor question to approved Q&A
2. `collectDetails` — gathers name, email, phone, matter description
3. `selectUrgency` — urgent vs non-urgent selection
4. `initiatePayment` — triggers Stripe Checkout ($1,320 urgent / $726 non-urgent)
5. `uploadDocuments` — handles file upload (PDF, JPG, PNG, DOCX, max 10MB)
6. `bookAppointment` — embeds Calendly (non-urgent only)
7. `submitMatter` — sends transcript + data to Zapier/Smokeball + emails firm

## Open Questions

- Voice input: Web Speech API is browser-native — need graceful fallback UI for unsupported browsers
- Stripe webhook endpoint: needs to be publicly accessible on Vercel (straightforward with API routes)
- Calendly embed: confirm which event type link the firm will provide
- Smokeball Zapier workflow: exact field mapping to be confirmed during Day 10-12 session

## Next Steps

Proceed to project scaffolding with `/workflows:plan`
