# Codebase Structure

**Analysis Date:** 2026-04-23

## Directory Layout

```
src/
├── app/                           # Next.js App Router pages and API routes
│   ├── api/                       # REST endpoints
│   │   ├── chat/                  # LLM streaming endpoint
│   │   ├── checkout/              # Stripe checkout session creation
│   │   ├── cron/                  # Scheduled tasks (upload cleanup)
│   │   ├── late-upload/           # Post-payment upload endpoints
│   │   ├── upload/                # Document upload handler
│   │   └── webhooks/              # Stripe, Calendly, Smokeball webhook handlers
│   ├── upload/                    # Upload token pages (UI for late uploads)
│   ├── layout.tsx                 # Root layout with fonts and globals
│   ├── page.tsx                   # Home page (main chat interface)
│   └── globals.css                # Tailwind directives
│
├── components/                    # React components (client-side)
│   ├── chat/
│   │   ├── chat-widget.tsx        # Main chat container with useChat()
│   │   ├── message-list.tsx       # Message rendering with tool outputs
│   │   ├── message-input.tsx      # Text input field
│   │   └── disclaimer-banner.tsx  # Legal disclaimer
│   ├── booking/
│   │   ├── calendly-embed.tsx     # Calendly widget for non-urgent scheduling
│   │   └── urgent-contact-card.tsx # Contact info for urgent matters
│   ├── payment/
│   │   └── payment-card.tsx       # Stripe embedded checkout form
│   └── upload/
│       ├── document-upload.tsx    # File upload UI
│       └── late-upload-client.tsx # Late upload page client component
│
├── lib/                           # Server-side utilities and tools
│   ├── tools/                     # AI SDK tool definitions
│   │   ├── index.ts               # Tool exports (toolset definition)
│   │   ├── collect-details.ts     # Validate name/email/phone/description
│   │   ├── match-question.ts      # Search knowledge base for Q&A
│   │   ├── select-urgency.ts      # Create intake record, send email
│   │   ├── initiate-payment.ts    # Stripe payment tool (client-render)
│   │   ├── upload-documents.ts    # File upload tool (client-render)
│   │   ├── schedule-appointment.tsx # Calendly scheduling tool
│   │   ├── show-options.tsx       # Quick-reply button tool
│   │   └── show-urgent-contact.ts # Urgent contact card tool
│   │
│   ├── knowledge-base/            # Static data
│   │   └── criminal-law.json      # Q&A pairs with keywords
│   │
│   ├── email/                     # Email templates
│   │   ├── payment-receipt.tsx    # React email component for payment receipt
│   │   └── assert-no-tracking.ts  # Verifies Resend config (no pixel tracking)
│   │
│   ├── late-upload/               # Post-payment upload logic
│   │   └── handle-completed.ts    # Processes completed upload, notifies firm
│   │
│   ├── kv.ts                      # Upstash Redis client + session CRUD
│   ├── intake.ts                  # Intake record Redis operations
│   ├── session-matter-map.ts      # Session-to-Smokeball matter mapping
│   ├── upload-session.ts          # Signed upload cookies
│   ├── upload-tokens.ts           # Upload token generation + hashing
│   ├── validators.ts              # Email, phone, file type/size validation
│   ├── branding.ts                # BRANDING config (firm name, URLs, etc)
│   ├── contact.ts                 # Contact helper utilities
│   ├── openrouter.ts              # Gemini 2.5 Flash via OpenRouter
│   ├── stripe.ts                  # Stripe client + pricing config
│   ├── resend.ts                  # Resend email client + senders
│   ├── zapier.ts                  # Zapier webhook integration
│   ├── system-prompt.ts           # LLM system prompt
│   ├── rate-limit.ts              # Upstash rate limiting
│   └── allowed-types.ts           # MIME type allowlist
│
├── types/                         # TypeScript type definitions
│   └── index.ts                   # QAPair, SessionData, UploadTokenRecord, etc
│
└── scripts/                       # Utility scripts
    └── revoke-upload-token.ts     # CLI to revoke upload tokens
```

## Directory Purposes

**`src/app/api/`:**
- Purpose: Next.js API routes (serverless functions)
- Contains: Route handlers (.ts files with `POST`/`GET` exports)
- Key files: 
  - `chat/route.ts` — LLM streaming with tool execution
  - `checkout/route.ts` — Stripe checkout session creation
  - `upload/route.ts` — File upload to Vercel Blob
  - `webhooks/stripe/route.ts` — Payment completion handling

**`src/components/`:**
- Purpose: Reusable React UI components
- Contains: Client components (.tsx with "use client")
- Key files:
  - `chat/chat-widget.tsx` — Main chat interface
  - `chat/message-list.tsx` — Message and tool output rendering
  - `payment/payment-card.tsx` — Stripe embedded checkout
  - `upload/document-upload.tsx` — File upload interface

**`src/lib/`:**
- Purpose: Server-side utilities, tools, and business logic
- Contains: Tool definitions, Redis helpers, validators, email, external service clients
- Key files:
  - `tools/*.ts` — AI SDK tool implementations
  - `kv.ts` — Session persistence
  - `intake.ts` — Intake record persistence
  - `stripe.ts` — Pricing and Stripe setup
  - `system-prompt.ts` — LLM instructions

**`src/lib/tools/`:**
- Purpose: AI-callable functions with Zod schema validation
- Pattern: Each tool is a `tool()` from `ai` package with `inputSchema` and optional `execute`
- Key insight: Server-side execute tools (collectDetails, selectUrgency) run on `/api/chat`; client-render tools (initiatePayment, uploadDocuments) return no-execute and trigger component rendering on client

**`src/lib/knowledge-base/`:**
- Purpose: Static criminal law Q&A data
- Format: JSON array of `{ id, question, answer, keywords }`
- Editability: Editable without code changes; reloaded on next deploy

**`src/lib/email/`:**
- Purpose: Email templates and utilities
- Contains: React Email components (.tsx), Resend client setup
- Key files:
  - `payment-receipt.tsx` — Template for payment receipt with upload link
  - `assert-no-tracking.ts` — Safety check for Resend config

## Key File Locations

**Entry Points:**
- `src/app/layout.tsx` — Root Next.js layout (fonts, metadata)
- `src/app/page.tsx` — Home page (renders ChatWidget)
- `src/app/api/chat/route.ts` — Chat endpoint (POST /api/chat)

**Configuration:**
- `src/lib/branding.ts` — Brand variables (firm name, tagline, URLs)
- `src/lib/openrouter.ts` — Gemini Flash model setup
- `src/lib/stripe.ts` — Pricing and Stripe client
- `src/lib/system-prompt.ts` — LLM system prompt

**Core Logic:**
- `src/components/chat/chat-widget.tsx` — Chat state management with `useChat()`
- `src/lib/tools/index.ts` — Tool exports and type definitions
- `src/lib/kv.ts` — Session CRUD
- `src/lib/intake.ts` — Intake record CRUD

**Testing:**
- None found (test directory not present)

## Naming Conventions

**Files:**
- Components: `camelCase.tsx` (e.g., `chat-widget.tsx`, `message-list.tsx`)
- Utilities: `camelCase.ts` (e.g., `kv.ts`, `validators.ts`)
- Routes: `route.ts` for API endpoints
- Layout/Pages: Kebab-case directories with `page.tsx` inside (e.g., `src/app/upload/[token]/page.tsx`)

**Directories:**
- Feature directories: Kebab-case (e.g., `chat/`, `payment/`, `late-upload/`)
- Dynamic routes: Brackets (e.g., `[token]/`, `[session]/`)

**Functions:**
- Exported functions: `camelCase` (e.g., `createSession`, `getSession`)
- Tool functions: Exported as named `const` with `tool()` from `ai` (e.g., `export const collectDetails = tool({...})`)

**Variables:**
- Constants: `UPPER_SNAKE_CASE` (e.g., `SESSION_TTL`, `MAX_FILES_PER_SESSION`, `PRICING`)
- React hooks: `use*` prefix (e.g., `useChat`)

**Types:**
- Interfaces: `PascalCase` (e.g., `SessionData`, `IntakeRecord`, `QAPair`)
- Type aliases: `PascalCase` (e.g., `ChatMessage`, `ChatTools`)
- Enums: `PascalCase` (e.g., `IntakeUrgency`)

## Where to Add New Code

**New Chat Tool:**
1. Create `src/lib/tools/[tool-name].ts`
2. Export a `tool()` with Zod schema and optional `execute`
3. Add to toolset in `src/lib/tools/index.ts`
4. Update system prompt in `src/lib/system-prompt.ts` with instructions
5. Add tool handler in `src/components/chat/message-list.tsx` if client-side rendering needed

**New API Endpoint:**
1. Create directory in `src/app/api/[feature]/`
2. Add `route.ts` with `POST`, `GET`, etc. export
3. For webhooks: add to `src/app/api/webhooks/[service]/route.ts`
4. Add signature verification (Stripe model in `src/app/api/webhooks/stripe/route.ts`)

**New Component:**
1. Create in `src/components/[feature]/[component-name].tsx`
2. Use "use client" for client-side interactivity
3. Import types from `src/types/index.ts`
4. Use `@/` path alias for imports

**New Page/Route:**
1. Create directory structure in `src/app/[route]/`
2. Add `page.tsx` for rendering
3. Use Server Components unless interactivity needed ("use client")
4. Fetch data in Server Component when possible

**New Utility:**
1. Add to `src/lib/[feature].ts` or `src/lib/[category]/[util].ts`
2. Export named functions
3. Use TypeScript types

**New Type:**
1. Add interface to `src/types/index.ts`
2. Or create feature-specific type file and export from index
3. Use for tool schemas and component props

## Special Directories

**`src/app/api/webhooks/`:**
- Purpose: External service callbacks (Stripe, Calendly, Smokeball)
- Generated: No
- Committed: Yes
- Pattern: Each service in subdirectory with `route.ts`; signature verification required

**`src/lib/knowledge-base/`:**
- Purpose: Static Q&A data (editable)
- Generated: No (manually maintained)
- Committed: Yes
- Pattern: JSON file; loaded at build time; no database queries

**`src/lib/email/`:**
- Purpose: Email templates using React Email
- Generated: No
- Committed: Yes
- Pattern: `.tsx` files with React components; rendered to HTML by Resend

**`src/lib/tools/`:**
- Purpose: AI SDK tool definitions
- Generated: No
- Committed: Yes
- Pattern: Each tool is a `tool()` definition with Zod schema; exported to toolset in index.ts

**`node_modules/`, `.next/`, `out/`:**
- Generated: Yes
- Committed: No (in .gitignore)

---

*Structure analysis: 2026-04-23*
