# Calendly Booking Integration — Design Spec

**Date:** 2026-04-11
**Status:** Design complete, awaiting implementation plan
**Author:** Claude (brainstormed with Prabu)

## Goal

After a visitor completes payment and optional document upload, give them an inline way to book their Legal Strategy Session without leaving the chat. Non-urgent visitors book via Calendly; urgent visitors are directed to call the firm during business hours. Also send a new client-facing confirmation email earlier in the flow that contains a payment-resume link and urgent-path phone number.

## Out of scope

- Rescheduling UI inside the chat (Calendly's own emails handle reschedule/cancel).
- Reminders, SMS, calendar invites beyond what Calendly sends natively.
- Refactoring `initiatePayment` to reuse a pre-created Stripe session from `selectUrgency`.
- Multiple Calendly event types per urgency tier.
- Automated tests (project has none today — manual testing matches convention).

## Current flow (baseline)

```
matchQuestion (Q&A) → collectDetails → selectUrgency → initiatePayment → uploadDocuments → "we'll be in touch"
```

The final "we'll be in touch" message is passive and loses momentum. The only email today is an internal transcript to `info@aquariuslawyers.com.au` sent from `collectDetails.execute`; there is no client-facing confirmation.

## Target flow

```
matchQuestion → collectDetails → selectUrgency → initiatePayment → uploadDocuments
                                       │
                                       └─ sendClientInquiryEmail (new, sent inside selectUrgency)
                                                                        │
                                        ┌───────────────────────────────┤
                                        ▼                               ▼
                              [urgency == non-urgent]         [urgency == urgent]
                                        │                               │
                                 scheduleAppointment           showUrgentContact
                                  (inline Calendly)              (call card)
                                        │                               │
                                 invitee.created webhook                │
                                        │                               │
                               sendBookingNotificationEmail              │
                                        ▼                               ▼
                               final chat confirmation         final chat confirmation
```

## Architecture

### New components

1. **`scheduleAppointment` tool** (client-rendered, non-urgent path) — renders an inline Calendly widget.
2. **`showUrgentContact` tool** (client-rendered, urgent path) — renders a phone/hours card.
3. **`CalendlyEmbed` component** (`src/components/booking/calendly-embed.tsx`) — wraps `react-calendly`'s `InlineWidget`, handles prefill and `calendly.event_scheduled` postMessage.
4. **`UrgentContactCard` component** (`src/components/booking/urgent-contact-card.tsx`) — phone link, business hours, optional "I've called" acknowledgement button.
5. **`FIRM_CONTACT` constants** (`src/lib/contact.ts`) — single source of truth for phone number, business hours, timezone.
6. **`sendClientInquiryEmail`** (added to `src/lib/resend.ts`) — new client-facing email sent from `selectUrgency.execute`.
7. **`sendBookingNotificationEmail`** (added to `src/lib/resend.ts`) — firm notification sent from the Calendly webhook.
8. **Calendly webhook endpoint** (`src/app/api/webhooks/calendly/route.ts`) — handles `invitee.created`.
9. **Stripe checkout resume endpoint** (`src/app/api/checkout/resume/route.ts`) — creates or reuses a Stripe session from a persisted intake record; used by email payment link.
10. **Long-lived intake record** (new Redis key `intake:{sessionId}`, 7-day TTL) — written inside `selectUrgency.execute`, read by the resume endpoint and (optionally) the webhook.

### New environment variables

| Name | Default | Purpose |
|---|---|---|
| `CALENDLY_BOOKING_URL` | `https://calendly.com/ekalaivan/advising-meeting` | Public Calendly event link embedded in the chat and email. Swap to firm URL post-launch. |
| `CALENDLY_WEBHOOK_SIGNING_KEY` | _(required, no default)_ | HMAC signing key from Calendly for verifying `invitee.created` webhook signatures. |
| `FIRM_NOTIFICATION_EMAIL` | `prabu@paretoid.com` | Recipient for `sendBookingNotificationEmail`. Swap to firm address post-launch. |

Existing env vars reused as-is: `RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.

### External prerequisites

- Calendly Standard tier ($10/mo minimum) for webhook support.
- Calendly webhook subscription to `invitee.created` on the target event type, pointing at `/api/webhooks/calendly`. Registered via a one-time curl command documented in the implementation plan.
- Calendly event type configured with a custom question for matter description (used as prefill field `a1`).
- `react-calendly` npm dep added.

## Component details

### 1. `scheduleAppointment` tool (non-urgent path)

File: `src/lib/tools/schedule-appointment.ts`

Client-rendered tool — no `execute`. The LLM calls this after `uploadDocuments` completes and when `selectUrgency` was `non-urgent`.

```ts
import { tool } from "ai";
import { z } from "zod";

export const scheduleAppointment = tool({
  description:
    "Present an inline Calendly booking widget so the visitor can pick a slot for their non-urgent Legal Strategy Session. Call this only after uploadDocuments completes AND when the earlier selectUrgency choice was 'non-urgent'. Never call for urgent matters.",
  inputSchema: z.object({
    sessionId: z.string().describe("The chat session ID"),
    prefillName: z.string().describe("Client's full name from collectDetails"),
    prefillEmail: z.string().describe("Client's email from collectDetails"),
    matterDescription: z
      .string()
      .describe("Brief matter description — shown as a Calendly custom answer"),
  }),
  outputSchema: z.object({
    booked: z.boolean(),
    eventStartTime: z.string().optional(),
    eventUri: z.string().optional(),
    inviteeUri: z.string().optional(),
  }),
});
```

Registered in `src/lib/tools/index.ts`.

### 2. `CalendlyEmbed` component

File: `src/components/booking/calendly-embed.tsx`

- Uses `<InlineWidget>` from `react-calendly`.
- `url` = `process.env.NEXT_PUBLIC_CALENDLY_BOOKING_URL` (exposed client-side via `NEXT_PUBLIC_` prefix).
- `prefill` = `{ name, email, customAnswers: { a1: matterDescription } }`.
- `utm` = `{ utmContent: sessionId }` — passed through to the webhook payload so we can tie bookings back to chat sessions.
- Listens for `window` `message` events with `event.data.event === "calendly.event_scheduled"`. On fire:
  - Extracts `payload.event.uri`, `payload.invitee.uri` from the Calendly event object.
  - Calls the AI SDK v6 `addToolResult({ tool: "scheduleAppointment", toolCallId, output: { booked: true, eventStartTime, eventUri, inviteeUri } })` — same pattern `document-upload.tsx` uses today.
- Visual states:
  - **Initial:** iframe visible, brand-coloured border, height ~650px.
  - **Booked:** iframe collapsed, replaced by a success card showing the booked start time (formatted in Australia/Sydney tz) and a "You'll also get a confirmation email from Calendly" subline.
- Failure states:
  - If `react-calendly` fails to load the iframe (network), show a fallback with a direct link to `CALENDLY_BOOKING_URL` plus prefill query params.

### 3. `showUrgentContact` tool (urgent path)

File: `src/lib/tools/show-urgent-contact.ts`

```ts
import { tool } from "ai";
import { z } from "zod";

export const showUrgentContact = tool({
  description:
    "Present the firm's phone number and business hours to an urgent-matter visitor. Call this only after uploadDocuments completes AND when the earlier selectUrgency choice was 'urgent'. Never call for non-urgent matters.",
  inputSchema: z.object({
    sessionId: z.string(),
  }),
  outputSchema: z.object({
    acknowledged: z.boolean(),
  }),
});
```

### 4. `UrgentContactCard` component

File: `src/components/booking/urgent-contact-card.tsx`

- Heading: "Call us for urgent matters"
- Large phone number as `<a href={FIRM_CONTACT.phoneHref}>` with a Lucide `Phone` icon. Brand colour `#61BBCA`.
- Business hours line: `FIRM_CONTACT.businessHours`.
- After-hours detection: uses `Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', hour12: false, weekday: 'short' })` to determine whether the current moment is inside 10:00–17:00 Mon–Fri. Shows an "Outside business hours — please call when we're open. Leave a voicemail for after-hours emergencies." note when outside.
- Secondary button: "I've called" → fires `addToolResult({ acknowledged: true })` so the LLM can wrap the conversation.

### 5. `FIRM_CONTACT` constants

File: `src/lib/contact.ts` (new)

```ts
export const FIRM_CONTACT = {
  phone: "+61 2 8858 3233",
  phoneHref: "tel:+61288583233",
  businessHours: "10:00am – 5:00pm AEST, Mon–Fri",
  timezone: "Australia/Sydney",
  businessHoursWindow: {
    start: 10, // 10:00
    end: 17,   // 17:00
    days: [1, 2, 3, 4, 5] as const, // Mon–Fri (getDay in local tz)
  },
} as const;
```

Imported by: `UrgentContactCard`, `sendClientInquiryEmail`, `sendBookingNotificationEmail`.

### 6. Client inquiry email — `sendClientInquiryEmail`

Added to `src/lib/resend.ts`. Signature:

```ts
export async function sendClientInquiryEmail({
  sessionId,
  clientName,
  clientEmail,
  matterDescription,
  urgency,
  displayPrice,
}: {
  sessionId: string;
  clientName: string;
  clientEmail: string;
  matterDescription: string;
  urgency: "urgent" | "non-urgent";
  displayPrice: string;
}): Promise<void>;
```

**Called from:** `selectUrgency.execute`, after the existing logic, wrapped in try/catch. Failures are logged and swallowed — never block the chat response.

**Why `selectUrgency` and not `collectDetails`:** urgency is known here, allowing tailored copy without a second email. Downside is visitors who abandon between `collectDetails` and `selectUrgency` (a ~1-message window) get no email — accepted.

**From:** `Aquarius Chatbot <chatbot@aquariuslawyers.com.au>` (same sender as the existing internal email).

**To:** `clientEmail`.

**Subject:** `Your Legal Strategy Session inquiry — Aquarius Lawyers`

**Body (HTML, both branches share header/footer):**

- Greeting by name.
- Matter summary table: description, urgency, fee (`displayPrice`).
- **Payment CTA button** — links to `${APP_URL}/api/checkout/resume?session=${sessionId}` with copy "Complete payment — {displayPrice}". Appears for all branches. (The resume endpoint itself is a no-op if the visitor has already paid — it redirects to a post-pay state rather than 404'ing.)
- **Urgent tail:**
  > For urgent matters, please call us on **+61 2 8858 3233** during our business hours (**10:00am – 5:00pm AEST, Mon–Fri**). We're ready to help as soon as we hear from you.
- **Non-urgent tail:**
  > For non-urgent matters, we'll schedule your Legal Strategy Session via Calendly. You can pick a slot at any time here:
  > `{CALENDLY_BOOKING_URL}?name={name}&email={email}`
- Footer: firm address, "reply to this email if you have any questions", standard legal disclaimer matching the existing internal email.

> **Payment gate — soft vs hard.** The chat flow enforces a hard gate: booking only unlocks after `initiatePayment` completes. The email's Calendly link is intentionally a **soft gate** escape hatch for visitors who abandon the chat mid-flow — they can still book a slot from the email even if they haven't paid. If that happens, the Calendly webhook notifies the firm via `sendBookingNotificationEmail`, and staff follows up to collect payment manually. This matches Prabu's original request wording ("link to book / reschedule in the email along with payment link if payment not done") and accepts that a small number of unpaid bookings may flow through. If the firm wants to harden this later, we can add a Stripe paid-check inside the Calendly webhook handler that blocks the notification and emails the client instead.

### 7. Firm booking notification — `sendBookingNotificationEmail`

Added to `src/lib/resend.ts`.

```ts
export async function sendBookingNotificationEmail({
  clientName,
  clientEmail,
  matterDescription,
  urgency,
  eventStartTime,
  eventUri,
  inviteeUri,
  stripeSessionId,
}: {
  clientName: string;
  clientEmail: string;
  matterDescription?: string;
  urgency?: "urgent" | "non-urgent";
  eventStartTime: string;
  eventUri: string;
  inviteeUri: string;
  stripeSessionId?: string;
}): Promise<void>;
```

**From:** `chatbot@aquariuslawyers.com.au`.
**To:** `process.env.FIRM_NOTIFICATION_EMAIL` (default `prabu@paretoid.com`).
**Subject:** `Booking confirmed — {clientName} — {startTimeAustralia}`
**Body:** client name, email, urgency, matter summary (if available), start time formatted in Australia/Sydney, Calendly event/invitee URIs as links, Stripe session id if available.

### 8. Calendly webhook endpoint

File: `src/app/api/webhooks/calendly/route.ts`

```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
```

**Method:** POST.

**Flow:**

1. Read raw body as text.
2. Verify `Calendly-Webhook-Signature` header using HMAC-SHA256 with `CALENDLY_WEBHOOK_SIGNING_KEY`. On mismatch, return 401.
3. Parse JSON. Only handle `event === "invitee.created"`. Ignore everything else with a 200.
4. Extract:
   - `payload.name` → clientName
   - `payload.email` → clientEmail
   - `payload.scheduled_event.start_time` → eventStartTime
   - `payload.scheduled_event.uri` → eventUri
   - `payload.uri` → inviteeUri
   - `payload.tracking.utm_content` → sessionId (may be absent if the visitor came from the email link directly rather than the embed)
5. If `sessionId` present, read `intake:{sessionId}` from Redis to hydrate `matterDescription`, `urgency`, `stripeSessionId`. All fields optional — missing fields just don't render in the email.
6. Call `sendBookingNotificationEmail`. Swallow errors (log only) — do not fail the webhook.
7. Return 200 JSON `{ ok: true }`.

**Idempotency:** no dedupe key. Duplicate firm emails are an acceptable failure mode; Calendly usually only retries on non-2xx responses.

### 9. Stripe checkout resume endpoint

File: `src/app/api/checkout/resume/route.ts`

```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
```

**Method:** GET.

**Flow:**

1. Read `session` query param; 400 if missing.
2. `const intake = await redis.get("intake:" + sessionId)`.
3. If not found or expired → 302 redirect to `/?expired=1`. The landing page should render a small banner "this session has expired — please restart the inquiry" (small addition to `src/app/page.tsx`).
4. If `intake.stripeSessionId` exists, retrieve that Stripe checkout session. If `status === "complete"` → 302 to `/?paid=1`. If still open → 302 to its `url`.
5. Otherwise create a new Stripe Checkout Session (same parameters as `initiatePayment.execute` uses today — factor a shared helper into `src/lib/stripe.ts` to avoid duplication), store the new session id back to `intake:{sessionId}` (re-setting the 7-day TTL), and 302 to the new checkout URL.

**Shared helper:** `createCheckoutSession({ urgency, customerEmail, metadata })` in `src/lib/stripe.ts`, used by both `initiatePayment.execute` and this resume endpoint.

### 10. Long-lived intake record

New Redis key: `intake:{sessionId}`.
TTL: 7 days (vs existing 1-hour chat session TTL).
Written from: `selectUrgency.execute` (after the existing logic).
Read from: checkout resume endpoint, Calendly webhook.

Shape:

```ts
type IntakeRecord = {
  sessionId: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  matterDescription: string;
  urgency: "urgent" | "non-urgent";
  displayPrice: string;
  amountCents: number;
  stripeSessionId?: string;     // set when Stripe checkout first created
  createdAt: string;            // ISO
};
```

## System prompt changes

Update `src/lib/system-prompt.ts`:

- Add **Step 2.5** (implementation note, not visitor-facing): "A client confirmation email is sent automatically inside `selectUrgency` — do not announce it unless the visitor asks."
- Add **Step 6 — SCHEDULE OR CONTACT** after the existing Step 5 (payment):
  > After `uploadDocuments` completes:
  > - If the earlier `selectUrgency` choice was **non-urgent**, call `scheduleAppointment` with `{ sessionId, prefillName, prefillEmail, matterDescription }`.
  > - If the earlier choice was **urgent**, call `showUrgentContact` with `{ sessionId }` instead.
  > - Never call both.
  > - After `scheduleAppointment` returns `{ booked: true }`, respond with a warm, brief closing: "Your session is confirmed. Calendly will send you a calendar invite and confirmation email. We look forward to speaking with you."
  > - After `showUrgentContact` returns `{ acknowledged: true }`, respond with: "Thanks. We'll speak with you as soon as you call. If you reach voicemail outside business hours, leave your details and we'll return your call first thing."
- Update rules section to add: "Never call `scheduleAppointment` for urgent matters. Never call `showUrgentContact` for non-urgent matters."

## Data flow summary

### Non-urgent happy path

1. Visitor → `collectDetails` → internal transcript email sent (existing behaviour).
2. Visitor → `selectUrgency(non-urgent)` → `intake:{sessionId}` written to Redis (TTL 7d) → `sendClientInquiryEmail` sent to visitor.
3. Visitor → `initiatePayment` → Stripe checkout session created via the shared `createCheckoutSession` helper → `intake:{sessionId}` updated with `stripeSessionId` (re-setting the 7-day TTL). The existing Stripe webhook is not modified.
4. Visitor → `uploadDocuments` (optional, existing behaviour).
5. LLM routes to `scheduleAppointment` → Calendly embed renders with prefill and `utm_content=sessionId`.
6. Visitor picks a slot → `calendly.event_scheduled` fires → `addToolResult({ booked: true, eventStartTime, eventUri, inviteeUri })`.
7. LLM sends closing message.
8. Calendly fires `invitee.created` webhook → signature verified → `intake:{sessionId}` hydrated from Redis → `sendBookingNotificationEmail` sent to firm.

### Urgent happy path

1–4 identical to above with `urgency=urgent`, client email contains the urgent phone tail.
5. LLM routes to `showUrgentContact` → `UrgentContactCard` renders.
6. Visitor taps phone link or clicks "I've called" → `addToolResult({ acknowledged: true })`.
7. LLM sends closing message.

### Resume-from-email path

1. Visitor bails mid-flow after seeing client email.
2. Clicks "Complete payment" in the email → `/api/checkout/resume?session={sessionId}`.
3. Intake record found → Stripe session created (or existing one reused) → visitor redirected to Stripe → completes payment.
4. Stripe webhook fires (existing) → visitor returns to chat-less success page (existing behaviour), or we can add a "return to chat" deep link as a follow-up. _Follow-up_ not in scope for this spec.

### Reschedule / cancel path

Handled entirely by Calendly's native emails. We do not subscribe to `invitee.canceled` in this spec. The firm sees reschedules/cancels via Calendly's own notifications, matching what they have today for existing Calendly bookings.

## Testing plan

Manual testing in dev (`npm run dev`) for both branches:

1. **Non-urgent full flow:**
   - Ask a legal question → book flow → provide details → pick non-urgent → verify client email arrives with non-urgent tail and working payment-resume link → pay with Stripe test card → upload (or skip) → verify Calendly embed renders with prefilled name, email, and matter as custom answer → pick a slot → verify chat-side confirmation message → verify webhook hits `/api/webhooks/calendly` (check Vercel logs) → verify firm notification lands in `prabu@paretoid.com`.
2. **Urgent full flow:**
   - Same as above but pick urgent → verify client email arrives with urgent tail and phone number → pay → upload → verify urgent contact card renders with correct phone, hours, after-hours note if applicable → click phone link (verify `tel:` opens dialer on mobile) → click "I've called" → verify chat wraps up.
3. **Payment resume from email:**
   - Complete details → select urgency → receive email → close chat tab without paying → click payment link in email → verify Stripe loads with correct price → pay → verify Stripe webhook fires.
4. **Expired resume:**
   - Set `intake:{sessionId}` TTL artificially short (or wait 7 days) → click resume link → verify `/expired=1` banner shows.
5. **Webhook signature verification:**
   - `curl` the webhook with no signature → expect 401.
   - `curl` with valid HMAC signature → expect 200 and firm email.
6. **LLM routing sanity:**
   - Run through flow 3x urgent and 3x non-urgent and confirm the model picks the right tool each time. If routing is unreliable, tighten the system prompt with more explicit "if/then" language.
7. **Build checks:** `npm run lint` and `npm run build` both clean.

## Open questions / follow-ups (not blockers)

- Whether to extend the Calendly webhook to also handle `invitee.canceled` for firm awareness of cancellations. Defer.
- Whether to add a "return to chat" deep link from Stripe success page that restores chat context. Defer.
- Whether to store a signed JWT in the resume link instead of relying on Redis for intake lookup. Defer — Redis 7-day TTL is enough for now.
- Firm Calendly account/event URL swap: tracked as a post-launch task.
- Firm notification email swap from `prabu@paretoid.com` to real firm address: tracked as a post-launch task.

## Prerequisites checklist (for implementation plan)

- [ ] Confirm Calendly Standard tier subscription.
- [ ] Configure Calendly event type to accept a custom question (`a1`) for matter description.
- [ ] Register the webhook subscription against the Calendly API (one-time curl command; documented in the implementation plan).
- [ ] Add env vars `CALENDLY_BOOKING_URL`, `CALENDLY_WEBHOOK_SIGNING_KEY`, `FIRM_NOTIFICATION_EMAIL`, plus public variant `NEXT_PUBLIC_CALENDLY_BOOKING_URL`, in Vercel project settings and `.env.local`.
- [ ] `npm install react-calendly`.
