# Technology Stack

**Analysis Date:** 2026-04-24

## Languages

**Primary:**
- TypeScript 5 - All source code and configuration

**Secondary:**
- JavaScript - Node runtime and build tools

## Runtime

**Environment:**
- Node.js (no specific version pinned; see package.json engines if present)

**Package Manager:**
- npm (default for Next.js projects)
- Lockfile: package-lock.json (presumed present)

## Frameworks

**Core:**
- Next.js 16.2.3 - Full-stack React framework with App Router
- React 19.2.4 - UI rendering and components
- React DOM 19.2.4 - DOM mounting

**AI & LLM:**
- Vercel AI SDK v6 (`ai`) - Core AI library for streaming and tools
  - `@ai-sdk/react` - Client-side hooks for AI interactions
  - `@ai-sdk/openai` - OpenAI provider bindings
  - `@openrouter/ai-sdk-provider` - OpenRouter custom provider for Gemini integration

**Styling:**
- Tailwind CSS v4 - Utility-first CSS framework
- `@tailwindcss/postcss` - PostCSS plugin for Tailwind v4

**Components & UI:**
- Lucide React 1.8.0 - Icon library
- React Markdown 10.1.0 - Markdown rendering in chat
- React Calendly 4.4.0 - Embedded calendar booking widget

**Testing & Quality:**
- ESLint 9 - Code linting
- `eslint-config-next` 16.2.3 - Next.js ESLint rules
- TypeScript - Static type checking

## Key Dependencies

**Critical:**
- `zod` 4.3.6 - Schema validation and parsing (used for AI tool inputs, webhook validation)
- `stripe` 22.0.1 - Payment processing SDK
- `@stripe/react-stripe-js` 6.1.0 - React components for Stripe integration
- `@stripe/stripe-js` 9.1.0 - Stripe JavaScript library
- `resend` 6.10.0 - Email delivery service

**Infrastructure:**
- `@upstash/redis` 1.37.0 - Redis client for session and intake storage (replaces deprecated Vercel KV)
- `@upstash/ratelimit` 2.0.8 - Rate limiting middleware
- `@vercel/blob` 2.3.3 - File storage for document uploads
- `file-type` 22.0.1 - File type detection from magic bytes

**Email:**
- `@react-email/components` 1.0.12 - React-based email templates

## Configuration

**Environment:**
- Environment variables (required for each service; see INTEGRATIONS.md)
- `NEXT_PUBLIC_*` - Public variables exposed to browser
- Server-only env vars - Private API keys, webhooks, secrets

**Build:**
- `next.config.ts` - Next.js build configuration
  - Turbopack enabled for faster builds
  - Custom headers for iframe embedding and security
- `tsconfig.json` - TypeScript compiler options
  - Strict mode enabled
  - Path alias: `@/*` → `./src/*`
- Implicit PostCSS config for Tailwind v4

## Platform Requirements

**Development:**
- Node.js (version not explicitly specified in codebase)
- npm package manager
- Modern browser with JavaScript support

**Production:**
- Deployment target: Vercel (recommended for Next.js 16)
- Alternative: Any Node.js-compatible hosting with support for Turbopack/ESM builds
- Environment variables must be configured in deployment platform

---

*Stack analysis: 2026-04-24*
