# Codebase Structure

**Analysis Date:** 2026-04-24

## Directory Layout

```
src/
├── app/                                 # Next.js App Router
│   ├── layout.tsx                       # Root layout (fonts, metadata)
│   ├── page.tsx                         # Home page (chat interface)
│   ├── globals.css                      # Tailwind + brand theme
│   ├── api/
│   │   ├── chat/
│   │   │   └── route.ts                 # Streaming chat endpoint
│   │   ├── checkout/
│   │   │   ├── route.ts                 # Create Stripe checkout session
│   │   │   └── resume/
│   │   │       └── route.ts             # Resume checkout after email link
│   │   ├── upload/
│   │   │   └── route.ts                 # File upload endpoint
│   │   ├── late-upload/
│   │   │   └── session/
│   │   │       └── route.ts             # Deferred upload (post-session)
│   │   ├── webhooks/
│   │   │   ├── stripe/
│   │   │   │   └── route.ts             # Stripe webhook handler
│   │   │   ├── calendly/
│   │   │   │   └── route.ts             # Calendly booking confirmation
│   │   │   └── smokeball-matter-created/
│   │   │       └── route.ts             # CRM integration webhook
│   │   └── cron/
│   │       └── upload-cleanup/
│   │           └── route.ts             # Cleanup stale uploads
│   └── upload/
│       ├── [token]/
│       │   └── page.tsx                 # Deferred upload page (email link)
│       └── session/
│           └── page.tsx                 # Upload session page
├── components/
│   ├── chat/
│   │   ├── chat-widget.tsx              # Main chat container, useChat hook
│   │   ├── message-list.tsx             # Renders messages + tool UIs
│   │   ├── message-input.tsx            # Input field, voice input, chips
│   │   └── disclaimer-banner.tsx        # Legal disclaimer
│   ├── booking/
│   │   ├── calendly-embed.tsx           # Inline Calendly widget
│   │   └── urgent-contact-card.tsx      # "Call us" card for urgent matters
│   ├── payment/
│   │   └── payment-card.tsx             # Stripe embedded checkout
│   └── upload/
│       ├── document-upload.tsx          # File picker + upload UI
│       └── late-upload-client.tsx       # Deferred upload wrapper
├── lib/
│   ├── tools/
│   │   ├── index.ts                     # Export all tools as ToolSet
│   │   ├── match-question.ts            # Server: search knowledge base
│   │   ├── collect-details.ts           # Server: validate name/email/phone
│   │   ├── select-urgency.ts            # Server: record urgency, send email
│   │   ├── show-options.ts              # Server: return suggestion chips
│   │   ├── initiate-payment.ts          # Client-rendered: Stripe payment
│   │   ├── upload-documents.ts          # Client-rendered: file upload
│   │   ├── schedule-appointment.ts      # Client-rendered: Calendly booking
│   │   └── show-urgent-contact.ts       # Client-rendered: contact card
│   ├── knowledge-base/
│   │   └── criminal-law.json            # Q&A pairs (editable)
│   ├── late-upload/
│   │   └── handle-completed.ts          # Process deferred uploads
│   ├── email/
│   │   ├── payment-receipt.tsx          # React Email template
│   │   ├── client-inquiry.tsx           # React Email template
│   │   └── assert-no-tracking.ts        # Validation helper
│   ├── kv.ts                            # Upstash Redis session helpers
│   ├── intake.ts                        # Upstash Redis intake record helpers
│   ├── openrouter.ts                    # Gemini 2.5 Flash via OpenRouter
│   ├── stripe.ts                        # Stripe config, pricing, checkout
│   ├── resend.ts                        # Resend email helpers
│   ├── zapier.ts                        # Zapier webhook sender
│   ├── validators.ts                    # Email, phone, file validation
│   ├── allowed-types.ts                 # MIME type whitelist
│   ├── rate-limit.ts                    # Upstash rate limit setup
│   ├── upload-tokens.ts                 # Generate/hash upload tokens
│   ├── upload-session.ts                # Parse upload session cookie
│   ├── session-matter-map.ts            # Map session → Smokeball matter
│   ├── system-prompt.ts                 # LLM system prompt
│   ├── branding.ts                      # Firm name, welcome message, etc.
│   └── contact.ts                       # Urgent contact details
├── types/
│   ├── index.ts                         # SessionData, IntakeRecord, etc.
│   └── speech-recognition.d.ts          # Web Speech API types
└── scripts/
    └── revoke-upload-token.ts           # CLI utility for token management
```

## Directory Purposes

**`src/app/`:**
- Purpose: Next.js App Router pages and API routes
- Contains: Page components, layout, API handlers, webhooks
- Key files: `page.tsx` (home), `layout.tsx` (root), `api/**/route.ts` (handlers)

**`src/components/`:**
- Purpose: React components, organized by feature
- Contains: Chat UI (widget, messages, input), payment UI, upload UI, booking UI
- Key files: `chat-widget.tsx` (main component tree), `message-list.tsx` (tool rendering)

**`src/lib/`:**
- Purpose: Shared utilities, configuration, business logic
- Contains: Tool definitions, API integrations, validators, system prompt
- Key files: `tools/index.ts` (tool exports), `kv.ts` (session state), `stripe.ts` (payment config)

**`src/lib/tools/`:**
- Purpose: Vercel AI SDK tool definitions
- Contains: Tool implementations, Zod schemas, execute functions
- Pattern: Each tool is a separate file; all exported from `index.ts`

**`src/lib/knowledge-base/`:**
- Purpose: Criminal law Q&A data
- Contains: `criminal-law.json` — array of QAPair objects
- Editable: Yes, no code rebuild needed

**`src/lib/email/`:**
- Purpose: Email templates using React Email
- Contains: Template components (`PaymentReceipt`, `ClientInquiry`)
- Used by: Resend helpers in `resend.ts`

**`src/types/`:**
- Purpose: TypeScript interfaces
- Contains: `SessionData`, `IntakeRecord`, `ClientDetails`, etc.
- Key file: `index.ts`

## Key File Locations

**Entry Points:**
- `src/app/page.tsx`: Home page, mounts ChatWidget
- `src/app/api/chat/route.ts`: Chat streaming endpoint
- `src/app/api/checkout/route.ts`: Stripe checkout creation

**Configuration:**
- `src/lib/branding.ts`: Firm name, welcome message, email footer
- `src/lib/stripe.ts`: PRICING, checkout session config
- `src/lib/system-prompt.ts`: LLM instructions
- `src/app/globals.css`: Tailwind theme (brand color, fonts)

**Core Logic:**
- `src/components/chat/chat-widget.tsx`: Main chat container, `useChat()` hook
- `src/lib/tools/index.ts`: Tool exports
- `src/lib/kv.ts`: Session CRUD (Redis)
- `src/lib/intake.ts`: Intake record CRUD (Redis)

**Testing:**
- No test files present in codebase

## Naming Conventions

**Files:**
- Route handlers: `route.ts` in feature directory (e.g., `api/chat/route.ts`)
- Components: PascalCase, `.tsx` extension (e.g., `ChatWidget.tsx`, `PaymentCard.tsx`)
- Utilities: camelCase, `.ts` extension (e.g., `kv.ts`, `validators.ts`)
- Tools: camelCase, `.ts` extension (e.g., `match-question.ts`, `initiate-payment.ts`)

**Directories:**
- Features: kebab-case (e.g., `late-upload`, `payment`, `booking`)
- Utilities: camelCase grouping (e.g., `lib/tools`, `lib/email`)
- Pages: lowercase with brackets for dynamic segments (e.g., `upload/[token]`)

**Functions:**
- Components: PascalCase (e.g., `ChatWidget`, `MessageList`)
- Utilities: camelCase (e.g., `createSession`, `validateEmail`)
- Tool functions: camelCase matching filename (e.g., `matchQuestion` in `match-question.ts`)

**Variables:**
- Constants: SCREAMING_SNAKE_CASE (e.g., `PRICING`, `MAX_FILES_PER_SESSION`, `SESSION_TTL`)
- State: camelCase (e.g., `messages`, `isListening`, `sessionId`)

**Types:**
- Interfaces: PascalCase, singular (e.g., `SessionData`, `QAPair`, `ClientDetails`)
- Enums: PascalCase (e.g., `CheckoutUrgency`)
- Type aliases: PascalCase (e.g., `ChatMessage`, `ChatTools`)

## Where to Add New Code

**New Tool:**
1. Create file in `src/lib/tools/{tool-name}.ts`
2. Define tool with Zod schema + optional `execute` function
3. Export from `src/lib/tools/index.ts` in `tools` ToolSet object
4. Reference in `src/lib/system-prompt.ts` if needed

**New Component:**
1. Create `.tsx` file in appropriate category folder (e.g., `src/components/{category}/{component-name}.tsx`)
2. Export default function (PascalCase)
3. Use `"use client"` directive if it uses hooks or browser APIs
4. Import in parent component

**New API Route:**
1. Create `src/app/api/{feature}/route.ts` or nested subdirectory
2. Export `POST`, `GET`, etc. as async functions
3. Use `NextResponse` for responses
4. Add to `tsconfig.json` path alias if reused widely

**New Utility:**
1. Create file in `src/lib/{feature}.ts` or `src/lib/{feature}/index.ts`
2. Export functions/constants
3. Use in components/API routes via `@/lib/{feature}` import

**New Type:**
1. Add interface to `src/types/index.ts`
2. Export and import as `import type { ... } from "@/types"`

**New Page:**
1. Create directory under `src/app/` with route structure
2. Add `page.tsx` with default export component
3. For dynamic routes, use `[param]` folder naming
4. Use `searchParams` async prop for query parameters

## Special Directories

**`src/lib/knowledge-base/`:**
- Purpose: Criminal law Q&A data
- Generated: No (manually maintained)
- Committed: Yes, to git
- Editable: Yes, JSON directly — no code rebuild required
- Format: Array of `{ id, question, answer, keywords }`

**`public/`:**
- Purpose: Static assets
- Generated: No
- Committed: Yes
- Files: Logo, branding assets

**`.planning/codebase/`:**
- Purpose: GSD analysis documents
- Generated: Yes (by GSD map-codebase)
- Committed: Yes
- Files: ARCHITECTURE.md, STRUCTURE.md, etc.

## Import Patterns

**Path Alias:**
- Configured: `@/` → `src/`
- Use everywhere except relative imports within same directory
- Example: `import { ChatWidget } from "@/components/chat/chat-widget"`

**Tool Imports (in API handlers):**
```typescript
import { tools, type ChatMessage } from "@/lib/tools";
import { convertToModelMessages, streamText } from "ai";
```

**Component Imports (client):**
```typescript
import { useChat } from "@ai-sdk/react";
import type { ChatMessage } from "@/lib/tools";
import { MessageList } from "@/components/chat/message-list";
```

## Subdirectory Guidance

**When adding to `src/lib/tools/`:**
- Keep each tool in its own file
- Name file after tool function (snake-case)
- Export single tool object with `tool()` constructor
- Add to `index.ts` ToolSet
- Do NOT create subdirectories — tools are flat

**When adding to `src/components/`:**
- Create category subdirectory if new feature (e.g., `analytics/`)
- Group related components in same directory
- Keep styles inline (Tailwind) or use CSS modules if shared

**When adding to `src/app/api/`:**
- Create feature directory with `route.ts`
- Nest for sub-routes (e.g., `api/upload/session/route.ts`)
- Do NOT create barrel exports; use direct file paths

---

*Structure analysis: 2026-04-24*
