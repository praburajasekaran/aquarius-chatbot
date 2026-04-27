# Architecture

**Analysis Date:** 2026-04-24

## Pattern Overview

**Overall:** Vercel AI SDK streaming + tool-driven conversation engine with client-side rendering

**Key Characteristics:**
- LLM-driven chatbot using Vercel AI SDK v6 (`ai`, `@ai-sdk/react`)
- Server-side streaming with `streamText()` and `convertToModelMessages()`
- Tools define conversation steps: some execute server-side (`matchQuestion`, `collectDetails`, `selectUrgency`, `showOptions`), others render client-side (`initiatePayment`, `uploadDocuments`, `scheduleAppointment`, `showUrgentContact`)
- Session state stored in Upstash Redis (1hr TTL)
- Intake records stored in separate Upstash Redis key namespace (7-day TTL)
- Payment and document flow managed via Stripe webhooks and Vercel Blob storage
- Conversation orchestrated by detailed system prompt with explicit step-by-step flow rules

## Layers

**API Layer (Server):**
- Purpose: Request handlers, webhooks, tool execution
- Location: `src/app/api/`
- Contains: Route handlers, webhook processors, checkout creation
- Depends on: Stripe SDK, Upstash Redis, Resend (email), Zapier, Vercel Blob
- Used by: Frontend, external services (Stripe, webhooks)

**Tools Layer (Hybrid):**
- Purpose: Define conversation actions, validation, and side effects
- Location: `src/lib/tools/`
- Contains: Tool definitions (Zod schemas + execute functions or outputSchema for client rendering)
- Depends on: KV store, Stripe, Resend, validators, knowledge base
- Used by: `/api/chat/route.ts` (server), ChatWidget client component

**Components Layer (Client):**
- Purpose: UI rendering, user interactions
- Location: `src/components/`
- Contains: Chat widget, message list, input, payment card, upload widget, booking widget
- Depends on: Stripe.js, react-calendly, react-markdown, Lucide icons
- Used by: Page components

**Configuration & Utility Layer:**
- Purpose: Shared helpers, validators, constants
- Location: `src/lib/`, `src/types/`, `src/lib/knowledge-base/`
- Contains: KV helpers, Stripe config, validators, branding, system prompt, knowledge base JSON
- Depends on: External SDKs
- Used by: All layers

## Data Flow

**Chat Message Flow:**

1. User types → `MessageInput` sends to `/api/chat`
2. `/api/chat` calls `streamText()` with messages, system prompt, and tools
3. LLM streams response, may call tools
4. Server-side tools (`matchQuestion`, `collectDetails`, `selectUrgency`, `showOptions`) execute and resolve immediately — LLM sees output and continues in same stream
5. Client-side tools (`initiatePayment`, `uploadDocuments`, `scheduleAppointment`, `showUrgentContact`) stream as part message with schema but no execute — client renders UI
6. Client renders tool UI, user completes action (pays, uploads, books)
7. Client calls `addToolOutput()` with result
8. Stream resumes, LLM sees tool output and generates next response
9. `shouldAutoContinue()` logic auto-resumes for certain tools to avoid extra user click

**Session & Payment Flow:**

1. Session ID generated client-side on mount (`generateSessionId()`)
2. On `selectUrgency` execution, intake record created in Redis with 7-day TTL
3. On `initiatePayment`, client calls `/api/checkout` to create Stripe session
4. User completes Stripe checkout → Stripe webhook hits `/api/webhooks/stripe`
5. Webhook updates session in Redis, creates upload token, sends payment receipt email
6. Post-upload, depending on urgency: either `scheduleAppointment` (non-urgent) or `showUrgentContact` (urgent)
7. Calendly or contact acknowledgment creates final callback

**State Management:**

- **Chat state**: Managed by Vercel AI SDK's `useChat()` hook in `ChatWidget`
- **Session state**: Client-side session ID, server-side Redis session record
- **Intake state**: Redis with 7-day TTL, keyed by session ID
- **Payment state**: Stripe session ID stored in intake record
- **Upload state**: File refs in session, documents stored in Vercel Blob
- **Suggestion chips**: Extracted from most recent `showOptions` tool call

## Key Abstractions

**Tool (Vercel AI SDK):**
- Purpose: Define an action the LLM can call during conversation
- Examples: `src/lib/tools/match-question.ts`, `src/lib/tools/collect-details.ts`
- Pattern: `tool({ description, inputSchema, execute?, outputSchema? })`
- Server-side tools have `execute` function; client-side tools have `outputSchema` only
- Tools export from `src/lib/tools/index.ts` as `ToolSet`

**Session Record (`SessionData`):**
- Purpose: Ephemeral user conversation state
- Location: `src/types/index.ts`
- Includes: name, email, phone, matter, urgency, payment status, upload refs, Calendly event
- Lifetime: 1 hour in Redis

**Intake Record (`IntakeRecord`):**
- Purpose: Persist inquiry for lawyer review during 7-day intake window
- Location: `src/lib/intake.ts`
- Includes: All session details + stripe session ID, display price
- Lifetime: 7 days in Redis

**Knowledge Base (`QAPair[]`):**
- Purpose: Q&A pairs for criminal law questions
- Location: `src/lib/knowledge-base/criminal-law.json`
- Loaded by: `matchQuestion` tool for keyword-based search
- Editable without code changes

## Entry Points

**Chat Page (`src/app/page.tsx`):**
- Location: `src/app/page.tsx`
- Triggers: User navigates to root URL
- Responsibilities: Render root layout, show header with firm name, route display flags (expired, paid), mount `ChatWidget`

**Chat API (`src/app/api/chat/route.ts`):**
- Location: `src/app/api/chat/route.ts`
- Triggers: `ChatWidget` `useChat()` posts messages
- Responsibilities: Parse messages, call `streamText()` with LLM + tools, return streaming response
- Max duration: 30 seconds (Vercel timeout limit)

**Checkout API (`src/app/api/checkout/route.ts`):**
- Location: `src/app/api/checkout/route.ts`
- Triggers: `initiatePayment` tool renders `PaymentCard`, which POSTs to create checkout
- Responsibilities: Create Stripe checkout session, return `clientSecret`

**Upload API (`src/app/api/upload/route.ts`):**
- Location: `src/app/api/upload/route.ts`
- Triggers: `DocumentUpload` component POSTs files
- Responsibilities: Validate file type/size, store in Vercel Blob, track refs in session

**Stripe Webhook (`src/app/api/webhooks/stripe/route.ts`):**
- Location: `src/app/api/webhooks/stripe/route.ts`
- Triggers: Stripe posts `checkout.session.completed`
- Responsibilities: Update session payment status, create upload token, send receipt email

**Upload Token Page (`src/app/upload/[token]/page.tsx`):**
- Location: `src/app/upload/[token]/page.tsx`
- Triggers: Client opens link from receipt email
- Responsibilities: Validate token, allow deferred document upload (after initial session expires)

## Error Handling

**Strategy:** Fail gracefully, log server-side, surface user-friendly messages

**Patterns:**

- **Tool validation errors**: `collectDetails` returns `{ valid: false, errors: string[] }`, AI relays verbatim
- **Tool execution errors**: Try-catch in tool `execute` functions, log to console, return error state (e.g., "Failed to send email")
- **API errors**: Check response `.ok`, return JSON error with `status` code, front-end shows generic message
- **Webhook errors**: Construct event with try-catch, deduplicate by storing processed event IDs in Redis
- **File upload**: Validate type with `file-type` package + MIME check, validate size limits, return 400 on failure
- **Session expiry**: Return 400 "Session expired", prompt user to restart

## Cross-Cutting Concerns

**Logging:** `console.log()` and `console.error()` in server-side tool functions and API handlers. No structured logging framework.

**Validation:**
- Email: Regex in `validateEmail()` (`src/lib/validators.ts`)
- Phone: Australian phone pattern in `validatePhone()` (`src/lib/validators.ts`)
- File type: `file-type` package sniffs MIME, checked against `ALLOWED_TYPES` (`src/lib/allowed-types.ts`)
- File size: Max 25 MB per file, max 5 files per session

**Authentication:**
- No user authentication; session is ephemeral (client-side ID)
- Stripe webhook authenticated via signature verification
- Upload token (random hash) used for deferred uploads, destroyed after use

**Rate Limiting:** `@upstash/ratelimit` configured in `src/lib/rate-limit.ts`, applied to chat endpoint

**Branding:** All user-facing strings centralized in `src/lib/branding.ts`, read from env vars (e.g., `NEXT_PUBLIC_FIRM_NAME`)

---

*Architecture analysis: 2026-04-24*
