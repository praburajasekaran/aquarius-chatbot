# Architecture

**Analysis Date:** 2026-04-23

## Pattern Overview

**Overall:** AI-powered intake chatbot with multi-step legal matter collection, payment processing, and document management.

**Key Characteristics:**
- Next.js App Router (server and client components)
- Streaming LLM responses with tool-use orchestration via Vercel AI SDK v6
- Session state persisted in Upstash Redis with 1-hour TTL
- Two-tier pricing model (Urgent vs Non-Urgent) with Stripe payment integration
- Knowledge-base-driven Q&A system (JSON-based criminal law FAQ)
- Post-payment document upload with email delivery

## Layers

**Presentation (Client):**
- Purpose: Interactive UI for visitor conversation and tool rendering
- Location: `src/components/`
- Contains: React components (chat widget, message list, payment card, document upload, booking integrations)
- Depends on: `@ai-sdk/react` for chat state, Stripe.js for embedded checkout, Calendly/contact card rendering
- Used by: `src/app/layout.tsx` and page routes

**Chat Orchestration (Client):**
- Purpose: Manages conversation state and tool callbacks using Vercel AI SDK
- Location: `src/components/chat/chat-widget.tsx`
- Contains: `useChat()` hook, automatic tool result submission, message state
- Depends on: `/api/chat` endpoint, tool definitions in `src/lib/tools/`
- Used by: `src/app/page.tsx` (home page)

**API Layer (Server):**
- Purpose: REST endpoints for LLM streaming, payment, file upload, webhooks
- Location: `src/app/api/`
- Contains: Route handlers organized by function (chat, checkout, upload, webhooks)
- Depends on: OpenRouter (Gemini 2.5 Flash), Stripe, Upstash Redis, Vercel Blob, Resend
- Used by: Client components and external services (Stripe, Calendly webhooks)

**Tool Layer (Server-side execute):**
- Purpose: AI-callable functions that validate input, persist state, send emails
- Location: `src/lib/tools/`
- Contains: `collect-details`, `select-urgency`, `initiate-payment`, `upload-documents`, `schedule-appointment`, `show-urgent-contact`, `match-question`, `show-options`
- Depends on: `src/lib/intake.ts`, `src/lib/kv.ts`, `src/lib/resend.ts`, validators
- Used by: LLM in `/api/chat` route

**Session & State (Server):**
- Purpose: Redis-backed session storage for chat state and intake data
- Location: `src/lib/kv.ts` (sessions), `src/lib/intake.ts` (intake records)
- Contains: Session CRUD, intake record persistence, 1-hour/7-day TTL management
- Depends on: Upstash Redis
- Used by: Tools, API routes, chat endpoint

**Knowledge Base:**
- Purpose: Static Q&A data for criminal law question matching
- Location: `src/lib/knowledge-base/criminal-law.json`
- Contains: Array of QAPair objects with id, question, answer, keywords
- Depends on: None
- Used by: `matchQuestion` tool

**Configuration & Utils:**
- Purpose: Centralized configuration, validators, LLM setup
- Location: `src/lib/branding.ts`, `src/lib/validators.ts`, `src/lib/openrouter.ts`, `src/lib/stripe.ts`
- Contains: Brand vars from env, email/phone validators, Gemini Flash model setup, Stripe client + pricing
- Depends on: Environment variables
- Used by: Multiple layers (tools, components, API routes)

## Data Flow

**Main Conversation Flow:**

1. **Visitor initiates chat** → Client generates sessionId → `chat-widget.tsx` uses `useChat()` → messages sent to `/api/chat`

2. **LLM streaming** → `/api/chat` POST receives messages → `streamText()` calls Gemini 2.5 Flash with system prompt + tools → LLM selects tool → tool executed server-side → result streamed back to client

3. **Tool execution** → Tools in `src/lib/tools/` execute with validation:
   - `matchQuestion`: Searches knowledge base, returns matched answer or fallback
   - `collectDetails`: Validates name/email/phone/description, returns errors or valid details
   - `selectUrgency`: Creates intake record in Redis, sends client confirmation email
   - `initiatePayment`: Returns no-execute tool; client renders PaymentCard component
   - Payment webhook triggers after Stripe completion
   - `uploadDocuments`: Client-side file upload tool; triggers DocumentUpload component
   - `scheduleAppointment`: Renders Calendly embed for non-urgent matters
   - `showUrgentContact`: Renders contact card for urgent matters
   - `showOptions`: Renders quick-reply buttons

4. **Session persistence** → Session data (name, email, phone, urgency, payment status, uploads, calendly event) stored in Redis with 1hr TTL

5. **Post-payment flow** → Stripe webhook (`/api/webhooks/stripe`) → creates upload token → sends payment receipt email with upload link → creates intake record (persisted 7 days) → sends transcript email to firm

6. **Late document upload** → Client visits `/upload/[token]` page → uploads documents → updates session → triggers completion handler

**State Storage:**

- **Chat session** (`session:{sessionId}`): Ephemeral, 1-hour TTL, tracks contact details and urgency
- **Intake record** (`intake:{sessionId}`): 7-day TTL, persists full inquiry details for firm workflow
- **Upload tokens** (`upload-token:{hashedToken}`): Maps tokens to session metadata
- **Stripe dedupe** (`stripe-session:{stripeSessionId}`): Prevents duplicate webhook processing

## Key Abstractions

**ChatMessage (Union Type):**
- Purpose: Type-safe representation of all message and tool types
- Examples: `src/types/index.ts` defines `ChatMessage = UIMessage<never, UIDataTypes, ChatTools>`
- Pattern: Discriminated union based on `message.role` (user/assistant) and `part.type` (text/tool-call/tool-result)

**Tool Definition Pattern (AI SDK):**
- Purpose: Declarative tool schema + execution
- Examples: `src/lib/tools/*.ts` each export a `tool()` from `ai` package
- Pattern: Schema defined with Zod `inputSchema`, optional `execute` function, `description` for LLM context
  - Server-side execute: `collectDetails`, `selectUrgency`, `match-question` — run on `/api/chat`
  - Client-side render: `initiatePayment`, `uploadDocuments`, `showOptions`, `showUrgentContact` — no execute, client renders component

**Session Key Convention:**
- Purpose: Consistent Redis key naming
- Pattern: `session:{sessionId}` for chat sessions, `intake:{sessionId}` for intake records

**Pricing Configuration:**
- Purpose: Single source of truth for costs and descriptions
- Location: `src/lib/stripe.ts` - `PRICING` object keyed by urgency tier
- Pattern: Each tier has `amount` (cents), `tier` (visitor-facing), `lineItem` (firm-facing), `displayPrice` (formatted)

## Entry Points

**Home Page:**
- Location: `src/app/page.tsx`
- Triggers: Visitor lands on root URL
- Responsibilities: Renders page header, optional session alerts (expired/paid), embeds ChatWidget

**Chat API:**
- Location: `src/app/api/chat/route.ts`
- Triggers: Client sends message via `sendMessage()`
- Responsibilities: Streams LLM response with tool calls; converts UI messages to model format; calls `streamText()`

**Upload Page:**
- Location: `src/app/upload/[token]/page.tsx`
- Triggers: Visitor clicks link in payment receipt email
- Responsibilities: Verifies upload token, renders file upload interface, persists uploads to Vercel Blob

**Checkout Endpoint:**
- Location: `src/app/api/checkout/route.ts`
- Triggers: Client submits payment form (via PaymentCard component)
- Responsibilities: Creates Stripe checkout session, stores session ID in intake record

**Webhooks:**
- Stripe: `src/app/api/webhooks/stripe/route.ts` — payment completion, token generation, emails
- Calendly: `src/app/api/webhooks/calendly/route.ts` — optional booking confirmation
- Smokeball: `src/app/api/webhooks/smokeball-matter-created/route.ts` — matter sync (future)

## Error Handling

**Strategy:** Permissive — tools return structured errors via schema (never throw); API routes catch and log; webhooks return 200 always.

**Patterns:**
- **Validation errors:** Tools return `{ valid: false, errors: string[] }` — user sees validation messages
- **Email/persistence failures:** Logged to console, non-blocking; conversation continues
- **Session not found:** Tool throws "Session expired" — LLM instructs user to restart
- **Webhook retries:** Stripe uses dedupe key (`stripe-session:{id}`) to ignore retries
- **File upload errors:** Returns error details in response; client re-requests

## Cross-Cutting Concerns

**Logging:** Console.error/info for failures and retries; no centralized logging service

**Validation:** 
- Email: Standard regex pattern in `src/lib/validators.ts`
- Phone: Australian format regex (0412 123 456, 02 1234 5678, +61 4 1234 5678 variants)
- File type: MIME whitelist (PDF, JPG, PNG, DOCX)
- File size: 10MB max per file, 5 files max per session

**Authentication:** None — public chatbot; sessionId generated client-side (not auth token); upload tokens hash-verified

**CORS:** Default Next.js (same-origin for API routes)

**Environment Config:** `.env.local` loaded via `process.env`; public vars prefixed `NEXT_PUBLIC_`

---

*Architecture analysis: 2026-04-23*
