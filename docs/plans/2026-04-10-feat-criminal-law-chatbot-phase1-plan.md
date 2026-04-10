---
title: "Criminal Law AI Chatbot — Phase 1"
type: feat
date: 2026-04-10
---

# Criminal Law AI Chatbot — Phase 1

## Overview

Build an AI-powered chatbot widget for the Aquarius Lawyers Criminal Law page. The chatbot answers firm-approved questions (text + voice), collects client details, processes LSS fees via Stripe, accepts document uploads, books appointments via Calendly (non-urgent), creates leads in Smokeball via Zapier, and emails transcripts to the firm. Architecture must be reusable for Phase 2 (four additional practice areas).

## Problem Statement / Motivation

Aquarius Lawyers needs 24/7 visitor engagement on their Criminal Law page to convert visitors into clients. Currently, visitors must call or email during business hours. The chatbot automates intake, payment collection, document gathering, and CRM entry — reducing manual work and capturing leads outside office hours.

## Tech Stack

| Layer | Choice | Version / Config |
|-------|--------|-----------------|
| Framework | Next.js (App Router) | Latest stable, TypeScript |
| Styling | Tailwind CSS | v4 |
| Icons | Lucide React | Per global CLAUDE.md |
| Chat SDK | Vercel AI SDK | `ai@4.x`, `@ai-sdk/react`, `@ai-sdk/google` |
| LLM | Gemini 2.5 Flash | `google/gemini-2.5-flash` via `@ai-sdk/google` |
| Payments | Stripe Checkout (embedded) | `stripe` SDK |
| Booking | Calendly | Embedded widget |
| Email | Resend | `resend` SDK |
| Automation | Zapier | Catch Hook webhook |
| Session Store | Vercel KV | Short TTL (1 hour) |
| Hosting | Vercel Pro | Serverless functions, edge |
| WordPress | Script tag / iframe embed | Isolated widget |

## Technical Approach

### Architecture

```
WordPress Criminal Law Page
  └── <script> embed → loads chatbot widget (iframe or script bundle)

Vercel (Next.js App Router)
  ├── /app/page.tsx                    → Chatbot full-page (iframe target)
  ├── /app/api/chat/route.ts           → AI SDK streaming + tool calling
  ├── /app/api/checkout/route.ts       → Stripe Checkout session creation
  ├── /app/api/webhooks/stripe/route.ts → Stripe payment confirmation
  ├── /app/api/submit/route.ts         → Final submission (Zapier + Resend)
  ├── /app/api/upload/route.ts         → Document upload handling
  └── /lib/
       ├── tools/                      → AI SDK tool definitions
       ├── knowledge-base/             → Approved Q&A pairs (JSON/TS)
       ├── stripe.ts                   → Stripe client config
       ├── kv.ts                       → Vercel KV session helpers
       ├── zapier.ts                   → Zapier webhook caller
       └── resend.ts                   → Email sender

Vercel KV
  └── session:{id} → { name, email, phone, matterType, urgency, paymentStatus, uploadRefs[], calendlyEvent? }
  └── TTL: 1 hour
```

### Conversation Flow (Tool-Calling Model)

The Vercel AI SDK's tool-calling loop models the visitor journey. Each step is a server-side tool with `execute`. The system prompt instructs the LLM to follow this sequence:

```
1. matchQuestion    → Match visitor question to approved Q&A. Fallback if no match.
2. collectDetails   → Gather name, email, phone, matter description. Validate formats.
3. selectUrgency    → Present urgent ($1,320) vs non-urgent ($726) choice.
4. initiatePayment  → Create Stripe Checkout session, return client secret.
5. uploadDocuments  → Accept file uploads (PDF/JPG/PNG/DOCX, max 10MB each).
6. bookAppointment  → Embed Calendly widget (non-urgent only). Urgent → "call firm" message.
7. submitMatter     → Send everything to Zapier + Resend. Show confirmation.
```

Key AI SDK patterns (v4):
- `streamText()` with `stopWhen: isStepCount(5)` for multi-step tool loops
- `convertToModelMessages()` (async) for message conversion
- `.toUIMessageStreamResponse()` for streaming response
- `useChat` with `DefaultChatTransport` on client
- Tools without `execute` render client-side UI (payment form, file upload, Calendly)
- `export const maxDuration = 30` on route for Vercel timeout

### Implementation Phases

#### Phase A: Project Scaffold & Core Chat (Days 1–3)

Foundation: Next.js project, AI SDK integration, Q&A matching.

**Tasks:**

- [x] Initialize Next.js project with TypeScript, Tailwind CSS, ESLint
  - `npx create-next-app@latest aquarius-chatbot --typescript --tailwind --eslint --app --src-dir`
- [x] Install dependencies:
  ```
  ai @ai-sdk/react @ai-sdk/google zod
  @vercel/kv stripe resend
  lucide-react
  ```
- [x] Create `CLAUDE.md` with project conventions
- [x] Initialize git repo, create `dev` branch
- [x] Create `.env.local` with all required env vars:
  ```
  GOOGLE_GENERATIVE_AI_API_KEY=
  STRIPE_SECRET_KEY=
  STRIPE_WEBHOOK_SECRET=
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
  KV_REST_API_URL=
  KV_REST_API_TOKEN=
  ZAPIER_WEBHOOK_URL=
  RESEND_API_KEY=
  NEXT_PUBLIC_CALENDLY_URL=
  NEXT_PUBLIC_URL=
  ```
- [x] Create `.env.example` (same keys, no values)
- [x] Set up project folder structure:

  ```
  src/
  ├── app/
  │   ├── layout.tsx
  │   ├── page.tsx                         # Chatbot UI (full page, iframe target)
  │   ├── api/
  │   │   ├── chat/route.ts                # AI SDK streaming endpoint
  │   │   ├── checkout/route.ts            # Stripe session creation
  │   │   ├── webhooks/stripe/route.ts     # Stripe webhook handler
  │   │   ├── upload/route.ts              # Document upload
  │   │   └── submit/route.ts              # Final submission (Zapier + Resend)
  │   └── globals.css
  ├── components/
  │   ├── chat/
  │   │   ├── chat-widget.tsx              # Main chat container
  │   │   ├── message-list.tsx             # Message display
  │   │   ├── message-input.tsx            # Text + voice input
  │   │   ├── voice-button.tsx             # Web Speech API toggle
  │   │   └── disclaimer-banner.tsx        # Legal disclaimer (always visible)
  │   ├── payment/
  │   │   ├── stripe-checkout.tsx          # Embedded Stripe Checkout
  │   │   └── payment-confirmation.tsx     # Payment success display
  │   ├── upload/
  │   │   └── document-upload.tsx          # File upload with validation
  │   ├── booking/
  │   │   └── calendly-embed.tsx           # Calendly inline widget
  │   └── ui/
  │       └── ... (shared UI primitives)
  ├── lib/
  │   ├── tools/
  │   │   ├── match-question.ts            # Q&A intent matching tool
  │   │   ├── collect-details.ts           # Client info collection tool
  │   │   ├── select-urgency.ts            # Urgency selection tool
  │   │   ├── initiate-payment.ts          # Stripe checkout tool
  │   │   ├── upload-documents.ts          # Doc upload tool
  │   │   ├── book-appointment.ts          # Calendly booking tool
  │   │   └── submit-matter.ts             # Final submission tool
  │   ├── knowledge-base/
  │   │   └── criminal-law.ts              # Approved Q&A pairs
  │   ├── stripe.ts                        # Stripe client singleton
  │   ├── kv.ts                            # Vercel KV session helpers
  │   ├── zapier.ts                        # Zapier webhook caller
  │   ├── resend.ts                        # Email sender
  │   └── validators.ts                    # Email, phone, file validators
  └── types/
      └── index.ts                         # Shared TypeScript types
  ```

- [x] Create knowledge base file `src/lib/knowledge-base/criminal-law.ts`:
  ```ts
  export const criminalLawQA = [
    {
      id: 'q1',
      question: 'What should I do if I have been charged?',
      answer: '...',  // Firm-approved answer
      keywords: ['charged', 'arrested', 'charge sheet'],
    },
    // ... 15+ Q&A pairs (content from client)
  ] as const;
  ```

- [x] Create system prompt in `src/lib/system-prompt.ts`:
  - Instruct LLM to ONLY match against approved Q&A
  - Define tool-calling sequence
  - Include disclaimer language
  - Include fallback response text

- [x] Build `src/app/api/chat/route.ts`:
  ```ts
  import { convertToModelMessages, streamText, UIMessage, isStepCount } from 'ai';
  import { google } from '@ai-sdk/google';
  import { tools } from '@/lib/tools';
  import { systemPrompt } from '@/lib/system-prompt';

  export const maxDuration = 30;

  export async function POST(req: Request) {
    const { messages }: { messages: UIMessage[] } = await req.json();
    const result = streamText({
      model: google('gemini-2.5-flash'),
      system: systemPrompt,
      messages: await convertToModelMessages(messages),
      stopWhen: isStepCount(5),
      tools,
    });
    return result.toUIMessageStreamResponse();
  }
  ```

- [x] Build `matchQuestion` tool — semantic matching against Q&A list
- [x] Build basic chat UI with `useChat` hook, message list, text input
- [x] Add disclaimer banner component (always visible)

**Success criteria:** User can ask a question, get a matched Q&A response or fallback. Streaming works end-to-end.

---

#### Phase B: Client Details & Session Management (Days 3–4)

Collect validated client information, persist to Vercel KV.

**Tasks:**

- [x] Build `collectDetails` tool:
  - Input schema: `{ name: string, email: string, phone: string, matterDescription: string }`
  - Validate email format (regex)
  - Validate Australian phone format (`04XX XXX XXX` or `+614XXXXXXXX` or landline `02/03/07/08 XXXX XXXX`)
  - Return validation errors for retry if invalid
- [x] Create `src/lib/kv.ts` — Upstash Redis session helpers:
  ```ts
  import { kv } from '@vercel/kv';

  export async function createSession(sessionId: string, data: SessionData) {
    await kv.set(`session:${sessionId}`, data, { ex: 3600 }); // 1hr TTL
  }

  export async function getSession(sessionId: string) {
    return kv.get<SessionData>(`session:${sessionId}`);
  }

  export async function updateSession(sessionId: string, data: Partial<SessionData>) {
    const existing = await getSession(sessionId);
    if (!existing) throw new Error('Session expired');
    await kv.set(`session:${sessionId}`, { ...existing, ...data }, { ex: 3600 });
  }
  ```
- [x] Build `selectUrgency` tool — presents urgent/non-urgent choice with pricing
- [x] Create `src/lib/validators.ts` — email, phone, file type validators
- [x] Add form-like UI components rendered by tool calls (detail collection form, urgency selector)
- [ ] Handle edit/back flow — allow user to correct submitted info before payment (deferred to polish phase)

**Success criteria:** Client details are validated, stored in KV, and urgency is selected. Session persists across tool calls.

---

#### Phase C: Stripe Payment Integration (Days 5–7)

Embedded Stripe Checkout for LSS fee collection.

**Tasks:**

- [x] Create `src/lib/stripe.ts` — Stripe client (lazy init)
- [x] Build `src/app/api/checkout/route.ts`:
  ```ts
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    currency: 'aud',
    line_items: [{
      price_data: {
        currency: 'aud',
        unit_amount: urgency === 'urgent' ? 132000 : 72600, // cents
        product_data: {
          name: urgency === 'urgent'
            ? 'Urgent Criminal Matter — Legal Strategy Session'
            : 'Non-Urgent Criminal Matter — Legal Strategy Session',
        },
      },
      quantity: 1,
    }],
    ui_mode: 'embedded',
    return_url: `${process.env.NEXT_PUBLIC_URL}/payment/confirmation?session_id={CHECKOUT_SESSION_ID}`,
    metadata: { sessionId, urgency },
  });
  ```
- [x] Build `src/app/api/webhooks/stripe/route.ts`:
  - Read raw body as `req.text()` (NOT `.json()`) for signature verification
  - Verify with `stripe.webhooks.constructEvent(body, sig, secret)`
  - On `checkout.session.completed`: update KV session `paymentStatus: 'paid'`
- [x] Build `initiatePayment` tool — creates checkout session, returns `clientSecret`
- [x] Build `src/components/payment/stripe-checkout.tsx` — embedded Stripe Checkout form (as payment-card.tsx)
- [ ] Build `src/components/payment/payment-confirmation.tsx` — success state (deferred to integration testing)
- [x] Add cost disclosure before payment (per Legal Profession Uniform Law)
- [x] Handle payment failures: card declined → allow retry with different card
- [x] Handle Stripe Checkout session timeout (default 24hrs, but set shorter: 30min)

**Success criteria:** User sees cost disclosure, pays via embedded Stripe Checkout, webhook confirms payment, KV session updated. Failed payments allow retry.

---

#### Phase D: Document Upload (Days 7–8)

File upload with validation, malware scanning, and temporary storage.

**Tasks:**

- [x] Build `src/app/api/upload/route.ts`:
  - Accept multipart form data
  - Validate file type: PDF, JPG, PNG, DOCX only
  - Validate file size: max 10MB per file
  - Validate file integrity (not corrupt/password-protected)
  - Store temporarily (Vercel Blob or in-memory buffer for Zapier forwarding)
  - Return upload reference ID, store in KV session
- [x] Build `uploadDocuments` tool — triggers client-side file upload UI
- [x] Build `src/components/upload/document-upload.tsx`:
  - Drag-and-drop + file picker
  - File type/size validation on client side (pre-upload check)
  - Upload progress indicator
  - Show uploaded file names with checkmarks
  - Allow multiple files
- [x] Handle upload failures — retry mechanism, clear error messages
- [x] Define max file count (suggest: 5 files per session)

**Success criteria:** User uploads documents (validated type/size), files stored temporarily, references saved to KV session.

---

#### Phase E: Calendly Booking & Urgent Path (Days 8–9)

Appointment booking for non-urgent, call prompt for urgent.

**Tasks:**

- [ ] Build `bookAppointment` tool:
  - Non-urgent: render Calendly inline widget
  - Urgent: display "Please call Aquarius Lawyers during office hours" with phone number and hours
- [ ] Build `src/components/booking/calendly-embed.tsx`:
  - Inline Calendly embed using scheduling link from env var
  - Pre-fill name and email from collected details
  - Listen for `calendly.event_scheduled` postMessage event
  - Store booking confirmation in KV session
- [ ] Define office hours display (content from client: Section 5.2)
- [ ] Handle Calendly edge case: no available slots → show fallback message with phone number

**Success criteria:** Non-urgent users can book via Calendly (embedded). Urgent users see call prompt with office hours. Booking data captured in KV.

---

#### Phase F: Submission, Email & Zapier (Days 9–10)

Final matter submission — email transcript + Smokeball automation.

**Tasks:**

- [ ] Build `submitMatter` tool — orchestrates final submission
- [ ] Build `src/app/api/submit/route.ts`:
  1. Read full session from KV
  2. Build HTML transcript of entire conversation
  3. Send email via Resend to `info@aquariuslawyers.com.au`:
     - Full chat transcript
     - Client details (name, email, phone, matter type)
     - Payment confirmation (amount, Stripe session ID)
     - Uploaded document list
     - Appointment time (if non-urgent)
  4. Fire Zapier webhook with flat payload:
     ```ts
     {
       client_name, client_email, client_phone,
       matter_type, matter_description, urgency,
       payment_amount, payment_id,
       appointment_time, // null for urgent
       document_urls: [...],
       source: 'aquarius-chatbot',
       created_at: new Date().toISOString(),
     }
     ```
  5. Forward uploaded files to Zapier (base64 or URL reference)
  6. Delete KV session after successful submission
- [ ] Build `src/lib/zapier.ts`:
  - POST to `ZAPIER_WEBHOOK_URL` env var
  - Retry once on failure (5s timeout)
  - Log failure for manual follow-up if retry fails
- [ ] Build `src/lib/resend.ts`:
  - Send from configured domain
  - HTML email template with professional formatting
- [ ] Build confirmation UI — matter reference, payment receipt, doc list, appointment time
- [ ] Handle Zapier webhook failure — email the firm as fallback (they can manually create in Smokeball)

**Success criteria:** Email sent to firm with full transcript. Zapier webhook fires successfully. Smokeball gets the lead. User sees confirmation summary. KV session cleaned up.

---

#### Phase G: Voice Input & Polish (Days 10–11)

Web Speech API integration, UI polish, responsive design.

**Tasks:**

- [ ] Build `src/components/chat/voice-button.tsx`:
  - Use Web Speech API (`webkitSpeechRecognition` / `SpeechRecognition`)
  - Real-time speech-to-text (no audio recording/storage)
  - Visual indicator when listening (pulsing mic icon)
  - Auto-detect browser support; hide button if unsupported
  - Fallback: text-only input with note "Voice input not supported in this browser"
- [ ] Add privacy policy link to widget footer
- [ ] Style chatbot to match Aquarius Lawyers branding (colors, fonts from client)
- [ ] Responsive design: mobile sticky bar at bottom, desktop floating widget
- [ ] Add consent acknowledgment before starting chat (privacy + disclaimer)
- [ ] Add rate limiting on API routes (basic: IP-based, via Vercel middleware)
- [ ] Keyboard accessibility: tab navigation, enter to send, escape to close

**Success criteria:** Voice input works in Chrome/Edge/Safari. Widget is responsive. Disclaimer and privacy link visible at all times.

---

#### Phase H: WordPress Embed & Testing (Days 11–14)

Embed script, end-to-end testing, Zapier/Smokeball setup.

**Tasks:**

- [ ] Create embed script `public/embed.js`:
  ```js
  (function() {
    const iframe = document.createElement('iframe');
    iframe.src = 'https://aquarius-chatbot.vercel.app';
    iframe.style.cssText = 'position:fixed;bottom:20px;right:20px;width:400px;height:600px;border:none;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.15);z-index:9999;';
    // Toggle button, mobile responsive, etc.
    document.body.appendChild(iframe);
  })();
  ```
- [ ] Create minimized chat bubble (click to expand)
- [ ] WordPress integration instructions for client
- [ ] Deploy to Vercel (staging environment)
- [ ] Set up Stripe webhook endpoint in Stripe dashboard
- [ ] Zapier/Smokeball auth session with client (~15 min, Days 11-12)
- [ ] Configure Resend sending domain (DNS verification)
- [ ] End-to-end test: 5 complete user journeys per proposal Section 8:
  - [ ] Urgent: question → answer → details → payment → upload → call prompt → email → Smokeball
  - [ ] Non-urgent: question → answer → details → payment → upload → Calendly → email → Smokeball
  - [ ] Fallback: unmatched question → fallback response → details flow
  - [ ] Payment failure → retry → success
  - [ ] Voice input → question match → full flow
- [ ] Verify Smokeball data appears within 5 minutes (per acceptance criteria)
- [ ] Test on mobile (iOS Safari, Android Chrome)
- [ ] Test voice input across browsers (Chrome, Edge, Safari)

**Success criteria:** Widget embeds on WordPress. All 5 test journeys pass. Smokeball data correct within 5 mins. Email notifications received. No critical errors.

---

## Edge Cases & Mitigations

From SpecFlow analysis:

| Edge Case | Mitigation |
|-----------|------------|
| Q&A matching failure loop | After 3 unmatched questions, offer to proceed directly to detail collection |
| Payment completed but browser closed | Stripe webhook still fires → KV updated. On next visit, no recovery (session-based). Email firm with partial data as fallback |
| Stripe card declined | Show error, allow retry with different card. Checkout session stays open 30 min |
| Calendly no available slots | Show fallback: "No slots available. Please call [phone] during office hours" |
| File upload failure | Client-side retry. Clear error message. Allow skip if no documents available |
| Session TTL expiry mid-conversation | Show "Session expired" message. User must restart. Pre-payment data is lost (acceptable per spec). Post-payment: webhook already captured |
| Zapier webhook failure | Retry once. If still fails, email firm with full data as fallback — they create Smokeball entry manually |
| Voice input unsupported browser | Hide mic button, text-only mode. No error, just graceful degradation |
| Concurrent tabs/sessions | Each tab gets its own session ID. No dedup — acceptable for low volume |
| Bot/spam abuse | Rate limit: 10 chat sessions per IP per hour via Vercel middleware |

## Acceptance Criteria

### Functional Requirements

- [ ] Chatbot answers ONLY from firm-approved Q&A list (no generative answers)
- [ ] Fallback response for unmatched questions
- [ ] Text and voice input supported
- [ ] Collects: name, email (validated), phone (AU format), matter description
- [ ] Urgency selection: urgent ($1,320) or non-urgent ($726)
- [ ] Stripe payment processed successfully
- [ ] Document upload: PDF, JPG, PNG, DOCX, max 10MB
- [ ] Non-urgent: Calendly booking embedded
- [ ] Urgent: call prompt with office hours displayed
- [ ] Email with full transcript sent to info@aquariuslawyers.com.au
- [ ] Zapier creates Lead, Contact, Matter in Smokeball with documents
- [ ] Confirmation screen: matter ref, payment receipt, docs, appointment time
- [ ] Disclaimer visible at all times
- [ ] Privacy policy linked

### Non-Functional Requirements

- [ ] Chat data deleted at end of session (KV TTL)
- [ ] TLS 1.2+ for all data in transit
- [ ] No card data touches our servers (Stripe handles PCI)
- [ ] No audio recorded or stored (Web Speech API runs in-browser)
- [ ] Smokeball data appears within 5 minutes of submission
- [ ] Widget loads in < 3 seconds
- [ ] Mobile responsive (sticky bar on mobile, floating widget on desktop)
- [ ] Works in Chrome, Edge, Safari (voice in supported browsers only)

## Dependencies & Prerequisites

**From Client (before build starts):**
- [ ] 15+ approved Q&A pairs for Criminal Law
- [ ] Welcome message, fallback message, urgency wording, disclaimer text
- [ ] Cost disclosure text (per Legal Profession Uniform Law)
- [ ] Office hours definition
- [ ] Brand assets (colors, fonts, logo)
- [ ] WordPress admin access
- [ ] Stripe account + API keys (or guided setup)
- [ ] Calendly scheduling link (configured)
- [ ] Smokeball access credentials (for Zapier auth session)

**Third-Party Setup:**
- [ ] Vercel Pro account
- [ ] Vercel KV store provisioned
- [ ] Google AI API key (Gemini)
- [ ] Resend account + domain verification
- [ ] Zapier Professional plan + webhook configured

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Client Q&A content delayed | Medium | Blocks build | Use placeholder Q&As for development, swap real content later |
| Gemini Flash hallucination (answers outside Q&A) | Low | High (legal risk) | Strict system prompt + validate output against Q&A list server-side |
| Stripe webhook delivery failure | Low | High (lost payment) | Vercel KV fallback check on return URL. Stripe retries webhooks automatically |
| Zapier/Smokeball integration complexity | Medium | Medium | Dedicated auth session Days 11-12. Simple flat webhook payload |
| Vercel KV TTL too short for slow users | Medium | Low | 1hr TTL is generous for a form-like flow. Show countdown warning at 45min |

## References & Research

### Vercel AI SDK v4 Patterns
- `streamText()` + `stopWhen: isStepCount(5)` for multi-step tool loops
- `convertToModelMessages()` is async — must await
- `.toUIMessageStreamResponse()` for streaming
- `useChat` with `DefaultChatTransport` on client
- `export const maxDuration = 30` for Vercel timeout
- `tool()` helper with `inputSchema` (Zod) + `execute`
- Gemini Flash model ID: `gemini-2.5-flash`

### Stripe on Vercel
- Webhook body must be read as `req.text()` NOT `.json()` for signature verification
- Embedded checkout uses `ui_mode: 'embedded'` + `client_secret`
- Set checkout session timeout to 30 min (prevent stale sessions)

### Zapier Integration
- POST to Catch Hook URL (env var, treat as secret)
- Flat JSON payload — Zapier maps by key name
- No inbound auth — URL is the secret

### Resend
- Verify sending domain via DNS
- `react` prop for JSX email templates, `html` for strings
- Free tier: 3,000 emails/month (sufficient for this use case)

### Brainstorm
- `docs/brainstorms/2026-04-10-phase1-scaffold-brainstorm.md`

### Proposal
- `Aquarius Lawyers_Chatbot_Proposal_ Phase 1 and Phase 2.md`
- `flow.png` — visitor journey flowchart
