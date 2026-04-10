@AGENTS.md

# Aquarius Lawyers Chatbot

## Tech Stack
- Next.js (App Router, TypeScript)
- Tailwind CSS v4 (CSS-based theme config)
- Vercel AI SDK v6 (`ai`, `@ai-sdk/react`, `@ai-sdk/openai`)
- LLM: Gemini 2.5 Flash via OpenRouter
- Stripe (embedded checkout)
- Upstash Redis (session store, replaces deprecated Vercel KV)
- Resend (email)
- Zapier (Smokeball CRM integration)
- Lucide React (icons)

## Conventions
- Use `@/` path alias for imports
- AI SDK tools use `inputSchema` (Zod) + `execute` for server-side, no `execute` for client-side rendering
- Brand color: `brand` (#61BBCA), fonts: Rubik (headings), Open Sans (body)
- Q&A knowledge base in `src/lib/knowledge-base/criminal-law.json` — editable without code changes
- Session data in Upstash Redis with 1hr TTL

## Commands
- `npm run dev` — start dev server
- `npm run build` — production build
- `npm run lint` — ESLint
