# Technology Stack

**Analysis Date:** 2026-04-23

## Languages

**Primary:**
- TypeScript 5 - Full codebase (frontend, backend, utilities)
- JSX/TSX - React components in `src/components/` and `src/app/`

**Secondary:**
- JavaScript (ESM) - Configuration files (next.config.ts, eslint.config.mjs, postcss.config.mjs)

## Runtime

**Environment:**
- Node.js (version specified in .nvmrc or package.json implied)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` (present)

## Frameworks

**Core:**
- Next.js 16.2.3 - Full-stack framework with App Router (server-side, API routes, static generation)
- React 19.2.4 - UI components and hooks

**AI & LLM:**
- Vercel AI SDK v6 (`ai`, `@ai-sdk/react`, `@ai-sdk/openai`) - Agent framework for chat tools
- @openrouter/ai-sdk-provider 2.5.1 - OpenRouter integration for Gemini 2.5 Flash

**Styling:**
- Tailwind CSS v4 - Utility-first CSS framework
- @tailwindcss/postcss 4 - PostCSS plugin for Tailwind v4

**UI Components:**
- Lucide React 1.8.0 - Icon library
- react-markdown 10.1.0 - Markdown rendering in chat

**Email:**
- @react-email/components 1.0.12 - React email template components (used in `src/lib/email/`)
- Resend 6.10.0 - Transactional email service

**Payment:**
- Stripe 22.0.1 - Payment processing SDK (deprecated, being replaced by BPoint)
- @stripe/stripe-js 9.1.0 - Browser client for Stripe
- @stripe/react-stripe-js 6.1.0 - React bindings for Stripe.js

**Scheduling:**
- react-calendly 4.4.0 - Calendly embed component

**Testing/Build:**
- ESLint 9 - Code linting
- eslint-config-next 16.2.3 - Next.js ESLint preset
- @types/node 20 - Node.js type definitions
- @types/react 19 - React type definitions
- @types/react-dom 19 - React DOM type definitions

## Key Dependencies

**Critical:**
- ai 6.0.158 - Vercel AI SDK for LLM integration and tool execution
- @upstash/redis 1.37.0 - Redis client (session store, rate limiting, deduplication)
- @upstash/ratelimit 2.0.8 - Rate limiting using Upstash Redis backend
- zod 4.3.6 - Schema validation library used throughout API routes and tools
- stripe 22.0.1 - Payment SDK (deprecated but still active during BPoint migration)

**Infrastructure:**
- @vercel/blob 2.3.3 - File storage for document uploads (`PUT` calls in `src/app/api/upload/`)
- file-type 22.0.1 - File type detection (MIME validation)

## Configuration

**Environment:**
- `.env.local` (not committed, created from `.env.example`)
- Environment variables organized by service (OpenRouter, Stripe, BPoint, Upstash, Zapier, Resend, Calendly, Vercel Blob, etc.)
- See `.env.example` for full list of required/optional env vars

**Build:**
- `tsconfig.json` - TypeScript configuration with `@/*` path alias
- `next.config.ts` - Next.js configuration with Turbopack settings and security headers
- `postcss.config.mjs` - PostCSS with Tailwind v4 plugin
- `eslint.config.mjs` - ESLint config using flat config format

## Platform Requirements

**Development:**
- Node.js runtime (version not pinned, but 18+ recommended for Next.js 16)
- npm package manager
- OpenRouter API key (for Gemini 2.5 Flash)
- Upstash Redis REST URL + token (for session/rate-limit store)
- Optional: Stripe keys (deprecated, being phased out)
- Optional: BPoint credentials for payment testing
- Optional: Calendly PAT for webhook testing

**Production:**
- Vercel (primary deployment platform per `vercel.json`)
- Upstash Redis (persistent session store, rate limiting)
- Vercel Blob (file storage for uploads)
- Resend (transactional email)
- OpenRouter (LLM API)
- Stripe webhook handling (during deprecation period)
- Calendly API + webhooks

**Deployment:**
- Vercel platform (Next.js native)
- Environment variables configured per Vercel deployment environment (Production/Preview/Development)
- Supports cron jobs (e.g., `/api/cron/upload-cleanup` for Vercel Cron)

## Database & Storage

**Session Store:**
- Upstash Redis (cloud Redis via REST API) - Stores `SessionData` with 1hr TTL
- Keys: `session:${sessionId}`, `intake:${sessionId}`, `session-matter:${sessionId}` (90d TTL)
- No traditional SQL database

**File Storage:**
- Vercel Blob - Public blob storage for uploaded documents
- Path pattern: `uploads/${sessionId}/${timestamp}-${filename}`
- Access: Public URLs returned to client

**Rate Limiting:**
- Upstash Redis via @upstash/ratelimit
- Sliding window limiters with analytics enabled
- Prefixes: `upload-rl:token`, `upload-rl:global`, `upload-rl:get`

## External API Clients

**LLM:**
- OpenRouter (via @openrouter/ai-sdk-provider) - Google Gemini 2.5 Flash
- API key: `OPENROUTER_API_KEY`

**Payments (Active):**
- Stripe SDK - Version 22.0.1
- Webhook signature verification via `stripe.webhooks.constructEvent()`

**Payments (Migration Target):**
- BPoint API (Commonwealth Bank) - Credentials in `.env.example` but no SDK imported
- Manual HTTP calls expected or external integration via Zapier

**Email:**
- Resend SDK - Version 6.10.0
- Sender: verified domain in Resend (configured via `RESEND_FROM_EMAIL` env var)

**Webhooks & Integrations:**
- Zapier (three production Zaps + one dev-only) - Via simple HTTP POST to webhook URLs
- Stripe webhooks - Endpoint: `/api/webhooks/stripe`
- Calendly webhooks - Endpoint: `/api/webhooks/calendly` with HMAC-SHA256 signature verification
- Smokeball (via Zapier) - Capture-back webhook at `/api/webhooks/smokeball-matter-created`

**Monitoring:**
- Console logging throughout (no external error tracking service detected)

---

*Stack analysis: 2026-04-23*
