# Calendly Booking Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inline Calendly booking in the chat for non-urgent matters, a call-the-firm card for urgent matters, a client confirmation email with a payment-resume link, and a Calendly webhook that notifies the firm when bookings come through.

**Architecture:** Two new client-rendered AI SDK tools (`scheduleAppointment`, `showUrgentContact`) route after `uploadDocuments` based on the urgency the visitor picked earlier. The non-urgent tool renders a `react-calendly` inline widget with prefill; it listens for `calendly.event_scheduled` postMessage and posts the result back as a tool output. A new `sendClientInquiryEmail` is sent from inside `selectUrgency.execute` and includes a Stripe checkout resume link handled by a new `/api/checkout/resume` route. A new Calendly webhook at `/api/webhooks/calendly` verifies HMAC signatures and sends a firm notification email via Resend. A new `intake:{sessionId}` Redis key (7-day TTL) persists inquiry data beyond the 1-hour chat session so the email and webhook can rehydrate state later.

**Tech Stack:** Next.js App Router (TypeScript), AI SDK v6, `react-calendly`, Upstash Redis, Stripe, Resend, Tailwind v4, Lucide React.

**Source spec:** `docs/brainstorms/2026-04-11-calendly-booking-integration-brainstorm.md`

**Conventions used by this plan:**
- Each task ends in a commit that compiles and lints cleanly.
- The project has no automated test suite today. "Verification" means `npm run lint` and `npm run build` succeeding, plus targeted manual smoke tests described in the final tasks.
- All imports use `@/` path alias per `CLAUDE.md`.
- Do not amend commits. Always make new commits.
- **Before every edit**, re-read the existing file if it has changed since this plan was written.

---

## File Inventory

### New files
- `src/lib/contact.ts` — `FIRM_CONTACT` constants
- `src/lib/intake.ts` — intake record type + Redis helpers (`intake:{sessionId}` key, 7d TTL)
- `src/lib/tools/schedule-appointment.ts` — `scheduleAppointment` AI SDK tool
- `src/lib/tools/show-urgent-contact.ts` — `showUrgentContact` AI SDK tool
- `src/components/booking/calendly-embed.tsx` — inline Calendly widget wrapper
- `src/components/booking/urgent-contact-card.tsx` — phone/hours card
- `src/app/api/webhooks/calendly/route.ts` — Calendly `invitee.created` handler
- `src/app/api/checkout/resume/route.ts` — Stripe checkout session resume

### Modified files
- `package.json` — add `react-calendly` dep
- `src/lib/stripe.ts` — extract `createCheckoutSession()` helper shared between existing `/api/checkout` route and the new resume route
- `src/lib/resend.ts` — add `sendClientInquiryEmail` + `sendBookingNotificationEmail`
- `src/lib/tools/select-urgency.ts` — write `intake:{sessionId}` record, send client email
- `src/lib/tools/initiate-payment.ts` — unchanged (client-rendered tool), but `src/app/api/checkout/route.ts` refactors to use the shared helper and writes `stripeSessionId` to the intake record
- `src/app/api/checkout/route.ts` — use shared `createCheckoutSession()`, persist `stripeSessionId` to intake
- `src/lib/tools/index.ts` — register the two new tools
- `src/lib/system-prompt.ts` — add Step 2.5 note and Step 6 routing instructions
- `src/components/chat/message-list.tsx` — render the two new tool UIs; add `onScheduleBooked` / `onUrgentAcknowledged` props
- `src/components/chat/chat-widget.tsx` — wire `handleScheduleBooked` and `handleUrgentAcknowledged` callbacks
- `src/app/page.tsx` — surface `?expired=1` banner when the resume link finds no intake

### Env var additions (document in `.env.example` if present; otherwise just list in the final task)
- `NEXT_PUBLIC_CALENDLY_BOOKING_URL` — public Calendly event URL for the embed
- `CALENDLY_BOOKING_URL` — server-side copy for the email
- `CALENDLY_WEBHOOK_SIGNING_KEY` — HMAC key from Calendly webhook subscription
- `FIRM_NOTIFICATION_EMAIL` — recipient for booking notifications (default `prabu@paretoid.com`)

---

## Task 1: Create a feature branch and add the `react-calendly` dependency

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Verify you are on the feature branch**

Run:
```bash
git status
git branch --show-current
```

Expected: working tree should be clean or only contain the two spec/plan docs created earlier. Current branch should be `fix/show-options-execute` (the active branch where earlier work on this feature lives) OR a new branch starting from it. If the user wants a fresh branch, run `git switch -c feat/calendly-booking`. Otherwise stay on the existing branch.

- [ ] **Step 2: Install `react-calendly`**

Run:
```bash
npm install react-calendly
```

Expected: `package.json` and `package-lock.json` updated. `react-calendly` added under `dependencies`.

- [ ] **Step 3: Verify the install**

Run:
```bash
node -e "console.log(require('react-calendly/package.json').version)"
```

Expected: prints a version number (≥ 4.x at time of writing — any maintained version is fine).

- [ ] **Step 4: Smoke-check the build still compiles**

Run:
```bash
npm run lint && npm run build
```

Expected: both succeed. No new errors introduced.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(calendly): add react-calendly dependency"
```

---

## Task 2: Add `FIRM_CONTACT` constants module

**Files:**
- Create: `src/lib/contact.ts`

- [ ] **Step 1: Create the constants file**

Write this exact content to `src/lib/contact.ts`:

```ts
// Single source of truth for firm contact details.
// Imported by UrgentContactCard, client email builder, and booking notification email.
export const FIRM_CONTACT = {
  phone: "+61 2 8858 3233",
  phoneHref: "tel:+61288583233",
  businessHours: "10:00am – 5:00pm AEST, Mon–Fri",
  timezone: "Australia/Sydney",
  businessHoursWindow: {
    startHour: 10,
    endHour: 17,
    weekdays: [1, 2, 3, 4, 5] as const, // 0=Sun, 1=Mon … matches Date.getDay() semantics
  },
} as const;

/**
 * Returns true if `now` is inside firm business hours, evaluated in Australia/Sydney tz.
 * Uses Intl.DateTimeFormat to avoid TZ bugs on the server.
 */
export function isInsideBusinessHours(now: Date = new Date()): boolean {
  const fmt = new Intl.DateTimeFormat("en-AU", {
    timeZone: FIRM_CONTACT.timezone,
    weekday: "short",
    hour: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const weekdayShort = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  const hour = parseInt(hourStr, 10);

  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const weekday = weekdayMap[weekdayShort] ?? -1;

  const inWeekday = (FIRM_CONTACT.businessHoursWindow.weekdays as readonly number[]).includes(weekday);
  const inHour =
    hour >= FIRM_CONTACT.businessHoursWindow.startHour &&
    hour < FIRM_CONTACT.businessHoursWindow.endHour;

  return inWeekday && inHour;
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
npm run lint && npm run build
```

Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/contact.ts
git commit -m "feat(contact): add FIRM_CONTACT constants and business-hours helper"
```

---

## Task 3: Add `intake` Redis record module

**Files:**
- Create: `src/lib/intake.ts`

- [ ] **Step 1: Create the intake module**

Write to `src/lib/intake.ts`:

```ts
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const INTAKE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export type IntakeUrgency = "urgent" | "non-urgent";

export interface IntakeRecord {
  sessionId: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  matterDescription: string;
  urgency: IntakeUrgency;
  displayPrice: string;
  amountCents: number;
  stripeSessionId: string | null;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export function intakeKey(sessionId: string): string {
  return `intake:${sessionId}`;
}

export async function createIntake(record: Omit<IntakeRecord, "createdAt" | "updatedAt" | "stripeSessionId"> & {
  stripeSessionId?: string | null;
}): Promise<IntakeRecord> {
  const now = new Date().toISOString();
  const full: IntakeRecord = {
    ...record,
    stripeSessionId: record.stripeSessionId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await redis.set(intakeKey(record.sessionId), full, { ex: INTAKE_TTL_SECONDS });
  return full;
}

export async function getIntake(sessionId: string): Promise<IntakeRecord | null> {
  return redis.get<IntakeRecord>(intakeKey(sessionId));
}

export async function updateIntake(
  sessionId: string,
  patch: Partial<Omit<IntakeRecord, "sessionId" | "createdAt">>
): Promise<IntakeRecord | null> {
  const existing = await getIntake(sessionId);
  if (!existing) return null;
  const updated: IntakeRecord = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  // Re-set with fresh 7-day TTL so active visitors don't time out mid-flow.
  await redis.set(intakeKey(sessionId), updated, { ex: INTAKE_TTL_SECONDS });
  return updated;
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
npm run lint && npm run build
```

Expected: both pass. `@upstash/redis` is already a dep.

- [ ] **Step 3: Commit**

```bash
git add src/lib/intake.ts
git commit -m "feat(intake): add 7-day intake record store keyed by sessionId"
```

---

## Task 4: Extract a `createCheckoutSession()` helper in `src/lib/stripe.ts`

**Files:**
- Modify: `src/lib/stripe.ts`
- Modify: `src/app/api/checkout/route.ts`

- [ ] **Step 1: Read the existing `stripe.ts` and checkout route to confirm their current shapes**

Run:
```bash
cat src/lib/stripe.ts src/app/api/checkout/route.ts
```

Confirm they match the shapes documented in the plan header. If they've drifted, adjust the patches below accordingly.

- [ ] **Step 2: Add the `createCheckoutSession` helper to `src/lib/stripe.ts`**

Append this to the end of `src/lib/stripe.ts` (after the existing `PRICING` export, keeping `getStripe`/`PRICING` unchanged):

```ts
export type CheckoutUrgency = keyof typeof PRICING;

export interface CreateCheckoutSessionArgs {
  sessionId: string;
  urgency: CheckoutUrgency;
  customerEmail?: string;
  returnUrlBase: string; // e.g. process.env.NEXT_PUBLIC_URL — do not include query string
  uiMode?: "embedded_page" | "hosted";
}

export async function createCheckoutSession(args: CreateCheckoutSessionArgs) {
  const pricing = PRICING[args.urgency];
  return getStripe().checkout.sessions.create({
    mode: "payment",
    currency: "aud",
    line_items: [
      {
        price_data: {
          currency: "aud",
          unit_amount: pricing.amount,
          product_data: { name: pricing.label },
        },
        quantity: 1,
      },
    ],
    ui_mode: args.uiMode ?? "embedded_page",
    redirect_on_completion: "if_required",
    return_url: `${args.returnUrlBase}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    metadata: { sessionId: args.sessionId, urgency: args.urgency },
    customer_email: args.customerEmail,
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // 30 min
  });
}
```

- [ ] **Step 3: Refactor `src/app/api/checkout/route.ts` to call the helper and persist `stripeSessionId` to intake**

Replace the current file contents entirely with:

```ts
import { NextResponse } from "next/server";
import { createCheckoutSession, PRICING } from "@/lib/stripe";
import { updateIntake } from "@/lib/intake";

export async function POST(req: Request) {
  const { sessionId, urgency } = (await req.json()) as {
    sessionId: string;
    urgency: "urgent" | "non-urgent";
  };

  if (!PRICING[urgency]) {
    return NextResponse.json({ error: "Invalid urgency" }, { status: 400 });
  }

  const checkoutSession = await createCheckoutSession({
    sessionId,
    urgency,
    returnUrlBase: process.env.NEXT_PUBLIC_URL ?? "",
  });

  // Persist stripeSessionId back to the long-lived intake record so the
  // email resume link can reuse it. Non-fatal if the intake doesn't exist yet
  // (e.g. someone hits the checkout endpoint before selectUrgency wrote intake).
  try {
    await updateIntake(sessionId, { stripeSessionId: checkoutSession.id });
  } catch (err) {
    console.error("[checkout] failed to persist stripeSessionId to intake", err);
  }

  return NextResponse.json({ clientSecret: checkoutSession.client_secret });
}
```

- [ ] **Step 4: Type-check**

Run:
```bash
npm run lint && npm run build
```

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stripe.ts src/app/api/checkout/route.ts
git commit -m "refactor(stripe): extract createCheckoutSession helper; persist session id to intake"
```

---

## Task 5: Add `sendClientInquiryEmail` to `src/lib/resend.ts`

**Files:**
- Modify: `src/lib/resend.ts`

- [ ] **Step 1: Re-read the file**

Run:
```bash
cat src/lib/resend.ts
```

Confirm the existing `sendTranscriptEmail` export shape. Do not remove it.

- [ ] **Step 2: Add the new function**

Append this to the end of `src/lib/resend.ts`:

```ts
import { FIRM_CONTACT } from "@/lib/contact";

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
}) {
  const appUrl = process.env.NEXT_PUBLIC_URL ?? "";
  const resumeUrl = `${appUrl}/api/checkout/resume?session=${encodeURIComponent(sessionId)}`;
  const calendlyUrl =
    process.env.CALENDLY_BOOKING_URL ??
    "https://calendly.com/ekalaivan/advising-meeting";
  const calendlyPrefillUrl =
    `${calendlyUrl}?name=${encodeURIComponent(clientName)}&email=${encodeURIComponent(clientEmail)}`;

  const urgentBlock = `
    <p style="margin:16px 0;font-size:15px;line-height:1.5">
      For urgent matters, please call us on
      <a href="${FIRM_CONTACT.phoneHref}" style="color:#085a66;font-weight:600">${FIRM_CONTACT.phone}</a>
      during our business hours (<strong>${FIRM_CONTACT.businessHours}</strong>).
      We'll be ready to help as soon as we hear from you.
    </p>
  `;

  const nonUrgentBlock = `
    <p style="margin:16px 0;font-size:15px;line-height:1.5">
      For non-urgent matters, we'll schedule your Legal Strategy Session via Calendly.
      You can pick a slot at any time here:
      <br />
      <a href="${calendlyPrefillUrl}" style="color:#085a66;font-weight:600">${calendlyUrl}</a>
    </p>
  `;

  const paymentBlock = `
    <p style="margin:24px 0">
      <a
        href="${resumeUrl}"
        style="display:inline-block;background:#61BBCA;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600"
      >Complete payment — ${displayPrice}</a>
    </p>
    <p style="margin:8px 0;font-size:13px;color:#555">
      If you've already paid, this link will take you to a confirmation page instead.
    </p>
  `;

  return resend.emails.send({
    from: "Aquarius Chatbot <chatbot@aquariuslawyers.com.au>",
    to: clientEmail,
    subject: "Your Legal Strategy Session inquiry — Aquarius Lawyers",
    html: `
      <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a">
        <h2 style="margin:0 0 16px;font-size:20px">Hi ${clientName},</h2>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.5">
          Thanks for your inquiry with Aquarius Lawyers. Here's a quick summary of what you shared with us:
        </p>
        <table style="border-collapse:collapse;width:100%;margin:16px 0">
          <tr><td style="padding:8px;border:1px solid #e5e5e5;font-weight:600;width:35%">Matter</td><td style="padding:8px;border:1px solid #e5e5e5">${matterDescription}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e5e5e5;font-weight:600">Urgency</td><td style="padding:8px;border:1px solid #e5e5e5">${urgency}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e5e5e5;font-weight:600">Fee</td><td style="padding:8px;border:1px solid #e5e5e5">${displayPrice}</td></tr>
        </table>
        ${paymentBlock}
        ${urgency === "urgent" ? urgentBlock : nonUrgentBlock}
        <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0" />
        <p style="margin:0;font-size:12px;color:#777;line-height:1.5">
          This email was sent by the Aquarius Lawyers chatbot in response to your inquiry.
          Aquarius Lawyers provides general information only — not legal advice. Reply to this
          email if you have any questions.
        </p>
      </div>
    `,
  });
}
```

- [ ] **Step 3: Type-check**

Run:
```bash
npm run lint && npm run build
```

Expected: both pass. `FIRM_CONTACT` imports cleanly.

- [ ] **Step 4: Commit**

```bash
git add src/lib/resend.ts
git commit -m "feat(email): add sendClientInquiryEmail with payment resume link"
```

---

## Task 6: Add `sendBookingNotificationEmail` to `src/lib/resend.ts`

**Files:**
- Modify: `src/lib/resend.ts`

- [ ] **Step 1: Append the function**

Add to the end of `src/lib/resend.ts`:

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
  stripeSessionId?: string | null;
}) {
  const to = process.env.FIRM_NOTIFICATION_EMAIL ?? "prabu@paretoid.com";

  // Format the start time in Australia/Sydney so staff see local time immediately.
  let startLocal = eventStartTime;
  try {
    startLocal = new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Sydney",
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(eventStartTime));
  } catch {
    // fall back to raw ISO string if parsing fails
  }

  return resend.emails.send({
    from: "Aquarius Chatbot <chatbot@aquariuslawyers.com.au>",
    to,
    subject: `Booking confirmed — ${clientName} — ${startLocal}`,
    html: `
      <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a">
        <h2 style="margin:0 0 16px;font-size:20px">New Legal Strategy Session booking</h2>
        <table style="border-collapse:collapse;width:100%;margin:16px 0">
          <tr><td style="padding:8px;border:1px solid #e5e5e5;font-weight:600;width:35%">Client</td><td style="padding:8px;border:1px solid #e5e5e5">${clientName}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e5e5e5;font-weight:600">Email</td><td style="padding:8px;border:1px solid #e5e5e5">${clientEmail}</td></tr>
          ${urgency ? `<tr><td style="padding:8px;border:1px solid #e5e5e5;font-weight:600">Urgency</td><td style="padding:8px;border:1px solid #e5e5e5">${urgency}</td></tr>` : ""}
          ${matterDescription ? `<tr><td style="padding:8px;border:1px solid #e5e5e5;font-weight:600">Matter</td><td style="padding:8px;border:1px solid #e5e5e5">${matterDescription}</td></tr>` : ""}
          <tr><td style="padding:8px;border:1px solid #e5e5e5;font-weight:600">Start time</td><td style="padding:8px;border:1px solid #e5e5e5">${startLocal}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e5e5e5;font-weight:600">Calendly event</td><td style="padding:8px;border:1px solid #e5e5e5"><a href="${eventUri}">${eventUri}</a></td></tr>
          <tr><td style="padding:8px;border:1px solid #e5e5e5;font-weight:600">Calendly invitee</td><td style="padding:8px;border:1px solid #e5e5e5"><a href="${inviteeUri}">${inviteeUri}</a></td></tr>
          ${stripeSessionId ? `<tr><td style="padding:8px;border:1px solid #e5e5e5;font-weight:600">Stripe session</td><td style="padding:8px;border:1px solid #e5e5e5">${stripeSessionId}</td></tr>` : ""}
        </table>
      </div>
    `,
  });
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
npm run lint && npm run build
```

Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/resend.ts
git commit -m "feat(email): add sendBookingNotificationEmail for firm webhook notifications"
```

---

## Task 7: Wire intake + client email into `selectUrgency.execute`

**Files:**
- Modify: `src/lib/tools/select-urgency.ts`

- [ ] **Step 1: Re-read the file**

Run:
```bash
cat src/lib/tools/select-urgency.ts
```

Confirm: currently pure compute, no side effects.

- [ ] **Step 2: Add intake write + client email**

The selectUrgency tool currently only knows `urgency`. It also needs `sessionId`, `name`, `email`, `phone`, and `matterDescription` (so we can persist to intake and send the email). Extend the input schema and execute body. Replace the file's contents with:

```ts
import { tool } from "ai";
import { z } from "zod";
import { PRICING } from "@/lib/stripe";
import { createIntake } from "@/lib/intake";
import { sendClientInquiryEmail } from "@/lib/resend";

export const selectUrgency = tool({
  description:
    "Record the visitor's urgency selection, persist inquiry details for the 7-day intake window, and send them a client confirmation email. Use this after collecting details. The visitor chooses between an urgent ($1,320 incl. GST) or non-urgent ($726 incl. GST) Legal Strategy Session.",
  inputSchema: z.object({
    sessionId: z.string().describe("The chat session ID"),
    urgency: z
      .enum(["urgent", "non-urgent"])
      .describe("The urgency level selected by the visitor"),
    clientName: z.string().describe("Client's full name from collectDetails"),
    clientEmail: z.string().describe("Client's email from collectDetails"),
    clientPhone: z.string().describe("Client's phone from collectDetails"),
    matterDescription: z
      .string()
      .describe("Matter description from collectDetails"),
  }),
  execute: async ({
    sessionId,
    urgency,
    clientName,
    clientEmail,
    clientPhone,
    matterDescription,
  }) => {
    const pricing = PRICING[urgency];

    // Persist intake for 7 days so email links and the webhook can rehydrate.
    // Non-fatal on failure — the chat can still continue without the intake record.
    try {
      await createIntake({
        sessionId,
        clientName,
        clientEmail,
        clientPhone,
        matterDescription,
        urgency,
        displayPrice: pricing.displayPrice,
        amountCents: pricing.amount,
      });
    } catch (err) {
      console.error("[selectUrgency] failed to create intake record", err);
    }

    // Send client confirmation email. Non-fatal on failure.
    try {
      await sendClientInquiryEmail({
        sessionId,
        clientName,
        clientEmail,
        matterDescription,
        urgency,
        displayPrice: pricing.displayPrice,
      });
    } catch (err) {
      console.error("[selectUrgency] failed to send client inquiry email", err);
    }

    return {
      urgency,
      amount: pricing.amount,
      displayPrice: pricing.displayPrice,
      label: pricing.label,
      costDisclosure:
        "In accordance with the Legal Profession Uniform Law, the fee for a Legal Strategy Session is a fixed fee. " +
        `The total cost for your ${urgency} matter is ${pricing.displayPrice}. ` +
        "This covers an initial consultation to assess your matter and provide a strategy. " +
        "Any further legal work will be quoted separately.",
    };
  },
});
```

- [ ] **Step 3: Type-check**

Run:
```bash
npm run lint && npm run build
```

Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/tools/select-urgency.ts
git commit -m "feat(tools): persist intake and send client email in selectUrgency"
```

---

## Task 8: Create `scheduleAppointment` AI SDK tool

**Files:**
- Create: `src/lib/tools/schedule-appointment.ts`

- [ ] **Step 1: Write the file**

```ts
import { tool } from "ai";
import { z } from "zod";

// Client-rendered tool — no execute. UI listens for calendly.event_scheduled
// postMessage and posts the result back via addToolOutput.
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

- [ ] **Step 2: Type-check**

Run:
```bash
npm run lint && npm run build
```

Expected: both pass. The tool is defined but not yet registered — that's Task 10.

- [ ] **Step 3: Commit**

```bash
git add src/lib/tools/schedule-appointment.ts
git commit -m "feat(tools): add scheduleAppointment Calendly tool skeleton"
```

---

## Task 9: Create `showUrgentContact` AI SDK tool

**Files:**
- Create: `src/lib/tools/show-urgent-contact.ts`

- [ ] **Step 1: Write the file**

```ts
import { tool } from "ai";
import { z } from "zod";

// Client-rendered tool — no execute. UI renders a phone/hours card and lets
// the visitor tap "I've called" to acknowledge.
export const showUrgentContact = tool({
  description:
    "Present the firm's phone number and business hours to an urgent-matter visitor. Call this only after uploadDocuments completes AND when the earlier selectUrgency choice was 'urgent'. Never call for non-urgent matters.",
  inputSchema: z.object({
    sessionId: z.string().describe("The chat session ID"),
  }),
  outputSchema: z.object({
    acknowledged: z.boolean(),
  }),
});
```

- [ ] **Step 2: Type-check**

Run:
```bash
npm run lint && npm run build
```

Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/tools/show-urgent-contact.ts
git commit -m "feat(tools): add showUrgentContact tool skeleton"
```

---

## Task 10: Register both new tools in `src/lib/tools/index.ts`

**Files:**
- Modify: `src/lib/tools/index.ts`

- [ ] **Step 1: Read the current file**

Run:
```bash
cat src/lib/tools/index.ts
```

Confirm it matches the earlier view. If it has drifted, adjust the patch.

- [ ] **Step 2: Add the imports and extend the tools object**

Replace the current imports + tools export with:

```ts
import type { InferUITools, ToolSet, UIDataTypes, UIMessage } from "ai";
import { matchQuestion } from "./match-question";
import { collectDetails } from "./collect-details";
import { selectUrgency } from "./select-urgency";
import { initiatePayment } from "./initiate-payment";
import { uploadDocuments } from "./upload-documents";
import { showOptions } from "./show-options";
import { scheduleAppointment } from "./schedule-appointment";
import { showUrgentContact } from "./show-urgent-contact";

export const tools = {
  matchQuestion,
  collectDetails,
  selectUrgency,
  initiatePayment,
  uploadDocuments,
  showOptions,
  scheduleAppointment,
  showUrgentContact,
} satisfies ToolSet;

export type ChatTools = InferUITools<typeof tools>;
export type ChatMessage = UIMessage<never, UIDataTypes, ChatTools>;
```

- [ ] **Step 3: Type-check**

Run:
```bash
npm run lint && npm run build
```

Expected: both pass. The `ChatMessage` type now includes `tool-scheduleAppointment` and `tool-showUrgentContact` part types.

- [ ] **Step 4: Commit**

```bash
git add src/lib/tools/index.ts
git commit -m "feat(tools): register scheduleAppointment and showUrgentContact tools"
```

---

## Task 11: Create `UrgentContactCard` component

**Files:**
- Create: `src/components/booking/urgent-contact-card.tsx`

- [ ] **Step 1: Create the directory and file**

Ensure `src/components/booking/` exists:

```bash
mkdir -p src/components/booking
```

Then write `src/components/booking/urgent-contact-card.tsx`:

```tsx
"use client";

import { Phone, Clock } from "lucide-react";
import { useState, useEffect } from "react";
import { FIRM_CONTACT, isInsideBusinessHours } from "@/lib/contact";

interface UrgentContactCardProps {
  onAcknowledge: () => void;
  disabled?: boolean;
}

export function UrgentContactCard({ onAcknowledge, disabled = false }: UrgentContactCardProps) {
  const [insideHours, setInsideHours] = useState<boolean | null>(null);

  useEffect(() => {
    // Evaluate on mount to avoid SSR/client hydration mismatch.
    setInsideHours(isInsideBusinessHours());
  }, []);

  return (
    <div
      role="region"
      aria-label="Call us for urgent matters"
      className="mx-11 p-4 rounded-2xl border border-brand/40 bg-brand/5"
    >
      <h3 className="text-lg font-semibold text-gray-900 mb-2">
        Call us for urgent matters
      </h3>

      <a
        href={FIRM_CONTACT.phoneHref}
        className="flex items-center gap-2 text-2xl font-bold text-[#085a66] hover:underline"
      >
        <Phone className="h-6 w-6" aria-hidden="true" />
        {FIRM_CONTACT.phone}
      </a>

      <div className="mt-2 flex items-center gap-2 text-sm text-gray-700">
        <Clock className="h-4 w-4" aria-hidden="true" />
        <span>{FIRM_CONTACT.businessHours}</span>
      </div>

      {insideHours === false && (
        <p className="mt-3 text-sm text-gray-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
          We're outside business hours right now. Please call when we're open.
          For after-hours emergencies, leave a voicemail and we'll return your call first thing.
        </p>
      )}

      <button
        type="button"
        onClick={onAcknowledge}
        disabled={disabled}
        className="mt-4 px-4 min-h-[44px] rounded-full border border-[#085a66] text-[#085a66] hover:bg-[#085a66] hover:text-white transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      >
        I've called
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
npm run lint && npm run build
```

Expected: both pass. Lucide and `FIRM_CONTACT` import cleanly.

- [ ] **Step 3: Commit**

```bash
git add src/components/booking/urgent-contact-card.tsx
git commit -m "feat(booking): add UrgentContactCard component"
```

---

## Task 12: Create `CalendlyEmbed` component

**Files:**
- Create: `src/components/booking/calendly-embed.tsx`

- [ ] **Step 1: Write the file**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { InlineWidget } from "react-calendly";
import { CheckCircle2 } from "lucide-react";

interface CalendlyEmbedProps {
  sessionId: string;
  prefillName: string;
  prefillEmail: string;
  matterDescription: string;
  onBooked: (result: {
    eventStartTime: string;
    eventUri: string;
    inviteeUri: string;
  }) => void;
  disabled?: boolean;
}

interface CalendlyScheduledPayload {
  event?: { uri?: string };
  invitee?: { uri?: string };
  // Calendly's postMessage payloads include these under `event.data.payload`.
}

// postMessage shape Calendly posts when a slot is booked.
interface CalendlyPostMessageData {
  event?: string;
  payload?: CalendlyScheduledPayload;
}

function isCalendlyEvent(data: unknown): data is CalendlyPostMessageData {
  if (!data || typeof data !== "object") return false;
  const d = data as { event?: unknown };
  return typeof d.event === "string" && d.event.startsWith("calendly.");
}

export function CalendlyEmbed({
  sessionId,
  prefillName,
  prefillEmail,
  matterDescription,
  onBooked,
  disabled = false,
}: CalendlyEmbedProps) {
  const [booked, setBooked] = useState<{
    eventStartTime: string;
    eventUri: string;
  } | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    function handler(e: MessageEvent) {
      if (!isCalendlyEvent(e.data)) return;
      if (e.data.event !== "calendly.event_scheduled") return;
      if (firedRef.current || disabled) return;

      const payload = e.data.payload ?? {};
      const eventUri = payload.event?.uri ?? "";
      const inviteeUri = payload.invitee?.uri ?? "";

      // The postMessage payload does not include a start time directly —
      // we fetch it lazily by calling Calendly's REST API from the server later.
      // For the immediate UI confirmation, we just show a generic success state,
      // and the webhook fills in the authoritative start time on the firm side.
      const eventStartTime = "";

      firedRef.current = true;
      setBooked({ eventStartTime, eventUri });
      onBooked({ eventStartTime, eventUri, inviteeUri });
    }

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onBooked, disabled]);

  const url =
    process.env.NEXT_PUBLIC_CALENDLY_BOOKING_URL ??
    "https://calendly.com/ekalaivan/advising-meeting";

  if (booked) {
    return (
      <div
        role="status"
        className="mx-11 p-4 rounded-2xl border border-green-200 bg-green-50 flex items-start gap-3"
      >
        <CheckCircle2 className="h-5 w-5 text-green-700 shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <p className="font-semibold text-green-900">Your session is confirmed.</p>
          <p className="text-sm text-green-800 mt-1">
            Calendly will email you a calendar invite and confirmation shortly.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-11 rounded-2xl overflow-hidden border border-brand/30">
      <InlineWidget
        url={url}
        prefill={{
          name: prefillName,
          email: prefillEmail,
          customAnswers: { a1: matterDescription },
        }}
        utm={{ utmContent: sessionId }}
        styles={{ height: "650px" }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
npm run lint && npm run build
```

Expected: both pass. `react-calendly` types come with the package.

- [ ] **Step 3: Commit**

```bash
git add src/components/booking/calendly-embed.tsx
git commit -m "feat(booking): add CalendlyEmbed component with postMessage listener"
```

---

## Task 13: Render the new tools in `MessageList` and wire callbacks in `ChatWidget`

**Files:**
- Modify: `src/components/chat/message-list.tsx`
- Modify: `src/components/chat/chat-widget.tsx`

- [ ] **Step 1: Re-read both files**

Run:
```bash
cat src/components/chat/message-list.tsx src/components/chat/chat-widget.tsx
```

Confirm the tool-rendering pattern (it matches the one documented in the plan header). Existing props flow: `onOptionSelect`, `onPaymentComplete`, `onUploadComplete`, `onUploadSkip`. We add two more.

- [ ] **Step 2: Extend `MessageList` props and imports**

At the top of `src/components/chat/message-list.tsx`, update the imports and `MessageListProps` interface. Replace the existing import block and props interface with:

```tsx
"use client";

import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { Bot, User } from "lucide-react";
import type { ChatMessage } from "@/lib/tools";
import { PaymentCard } from "@/components/payment/payment-card";
import { DocumentUpload } from "@/components/upload/document-upload";
import { CalendlyEmbed } from "@/components/booking/calendly-embed";
import { UrgentContactCard } from "@/components/booking/urgent-contact-card";

interface MessageListProps {
  messages: ChatMessage[];
  sessionId: string;
  onOptionSelect: (toolCallId: string, text: string) => void;
  onPaymentComplete: (toolCallId: string) => void;
  onUploadComplete: (toolCallId: string, uploaded: number) => void;
  onUploadSkip: (toolCallId: string) => void;
  onScheduleBooked: (
    toolCallId: string,
    result: { eventStartTime: string; eventUri: string; inviteeUri: string }
  ) => void;
  onUrgentAcknowledged: (toolCallId: string) => void;
}
```

And extend the function signature destructuring near the top:

```tsx
export function MessageList({
  messages,
  sessionId,
  onOptionSelect,
  onPaymentComplete,
  onUploadComplete,
  onUploadSkip,
  onScheduleBooked,
  onUrgentAcknowledged,
}: MessageListProps) {
```

- [ ] **Step 3: Add the two new tool render branches**

Locate the existing `tool-uploadDocuments` block in `message-list.tsx` (inside the `message.parts.map` body). Immediately after its closing `}`, before the `return null;` at the bottom of the map, insert:

```tsx
            // Schedule appointment tool (non-urgent branch)
            if (part.type === "tool-scheduleAppointment") {
              if (part.state === "input-available" || part.state === "input-streaming") {
                const isLatest = msgIndex === lastMsgIndex;
                return (
                  <CalendlyEmbed
                    key={part.toolCallId}
                    sessionId={part.input?.sessionId ?? sessionId}
                    prefillName={part.input?.prefillName ?? ""}
                    prefillEmail={part.input?.prefillEmail ?? ""}
                    matterDescription={part.input?.matterDescription ?? ""}
                    onBooked={
                      isLatest
                        ? (result) => onScheduleBooked(part.toolCallId, result)
                        : () => {}
                    }
                    disabled={!isLatest}
                  />
                );
              }
              if (part.state === "output-available") {
                return (
                  <div
                    key={part.toolCallId}
                    role="status"
                    className="mx-11 p-3 bg-green-50 border border-green-200 rounded-xl text-base text-green-900"
                  >
                    Session booked.
                  </div>
                );
              }
            }

            // Urgent contact card tool (urgent branch)
            if (part.type === "tool-showUrgentContact") {
              if (part.state === "input-available" || part.state === "input-streaming") {
                const isLatest = msgIndex === lastMsgIndex;
                return (
                  <UrgentContactCard
                    key={part.toolCallId}
                    onAcknowledge={
                      isLatest ? () => onUrgentAcknowledged(part.toolCallId) : () => {}
                    }
                    disabled={!isLatest}
                  />
                );
              }
              if (part.state === "output-available") {
                return (
                  <div
                    key={part.toolCallId}
                    role="status"
                    className="mx-11 p-3 bg-green-50 border border-green-200 rounded-xl text-base text-green-900"
                  >
                    Thanks — we'll be ready for your call.
                  </div>
                );
              }
            }
```

- [ ] **Step 4: Wire the two new callbacks in `ChatWidget`**

Replace `src/components/chat/chat-widget.tsx` handler block to add `handleScheduleBooked` and `handleUrgentAcknowledged`, and pass them to `MessageList`. Specifically, after the existing `handleUploadSkip` function, add:

```tsx
  function handleScheduleBooked(
    toolCallId: string,
    result: { eventStartTime: string; eventUri: string; inviteeUri: string }
  ) {
    addToolOutput({
      tool: "scheduleAppointment",
      toolCallId,
      output: {
        booked: true,
        eventStartTime: result.eventStartTime,
        eventUri: result.eventUri,
        inviteeUri: result.inviteeUri,
      },
    });
  }

  function handleUrgentAcknowledged(toolCallId: string) {
    addToolOutput({
      tool: "showUrgentContact",
      toolCallId,
      output: { acknowledged: true },
    });
  }
```

And inside the `<MessageList ... />` JSX, add the two new props:

```tsx
      <MessageList
        messages={messages}
        sessionId={sessionId}
        onOptionSelect={(toolCallId, text) =>
          addToolOutput({ tool: "showOptions", toolCallId, output: { selected: text } })
        }
        onPaymentComplete={handlePaymentComplete}
        onUploadComplete={handleUploadComplete}
        onUploadSkip={handleUploadSkip}
        onScheduleBooked={handleScheduleBooked}
        onUrgentAcknowledged={handleUrgentAcknowledged}
      />
```

- [ ] **Step 5: Type-check**

Run:
```bash
npm run lint && npm run build
```

Expected: both pass. TypeScript infers the `part.type === "tool-scheduleAppointment"` and `"tool-showUrgentContact"` discriminated union members from the updated `ChatTools` type.

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/message-list.tsx src/components/chat/chat-widget.tsx
git commit -m "feat(chat): render scheduleAppointment and showUrgentContact tool UIs"
```

---

## Task 14: Update the system prompt

**Files:**
- Modify: `src/lib/system-prompt.ts`

- [ ] **Step 1: Re-read the file**

Run:
```bash
cat src/lib/system-prompt.ts
```

- [ ] **Step 2: Update `selectUrgency` call shape and add Step 6**

Two edits required. First, update **Step 3** instructions so the LLM passes the new required fields to `selectUrgency` (it now needs `sessionId`, name, email, phone, matterDescription). Replace the existing Step 3 body with:

```
Step 3 — SELECT URGENCY
- Briefly explain the two options, then call BOTH selectUrgency AND showOptions together:
  • showOptions: ["Urgent — $1,320", "Non-urgent — $726"]
  • selectUrgency is called after the visitor picks one. You MUST pass { sessionId, urgency, clientName, clientEmail, clientPhone, matterDescription } — reuse the four fields you already collected in Step 2.
- Do not announce the client confirmation email that is sent automatically by selectUrgency unless the visitor asks about it.
```

Second, after the existing **Step 5 — PAYMENT** block, add a new **Step 6** block:

```
Step 6 — SCHEDULE OR CONTACT
- After uploadDocuments completes, route based on the urgency that was selected earlier:
  • If urgency was **non-urgent**, call scheduleAppointment with { sessionId, prefillName, prefillEmail, matterDescription }. prefillName and prefillEmail are the client's name and email from collectDetails.
  • If urgency was **urgent**, call showUrgentContact with { sessionId } instead.
  • Never call both tools. Never call scheduleAppointment for urgent matters. Never call showUrgentContact for non-urgent matters.
- After scheduleAppointment returns { booked: true }, reply warmly: "Your session is confirmed. Calendly will send you a calendar invite and a confirmation email shortly. We look forward to speaking with you."
- After showUrgentContact returns { acknowledged: true }, reply: "Thanks. We'll be ready as soon as you call us. If you reach voicemail outside business hours, leave your details and we'll return your call first thing."
```

Also add a new rule to the CRITICAL RULES section (rule 7):

```
7. NEVER send the final scheduling step before uploadDocuments has returned. NEVER call both scheduleAppointment and showUrgentContact in the same conversation. Route strictly by the urgency captured in Step 3.
```

The final `src/lib/system-prompt.ts` should contain all existing rules/steps plus these additions. Apply the edits carefully using the Edit tool rather than full rewrites.

- [ ] **Step 3: Type-check and lint**

Run:
```bash
npm run lint && npm run build
```

Expected: both pass (it's a plain TS string export).

- [ ] **Step 4: Commit**

```bash
git add src/lib/system-prompt.ts
git commit -m "feat(prompt): add Step 6 routing and selectUrgency field passthrough"
```

---

## Task 15: Create the Stripe checkout resume endpoint

**Files:**
- Create: `src/app/api/checkout/resume/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createCheckoutSession, getStripe } from "@/lib/stripe";
import { getIntake, updateIntake } from "@/lib/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session");
  const appUrl = process.env.NEXT_PUBLIC_URL ?? "";

  if (!sessionId) {
    return NextResponse.redirect(`${appUrl}/?expired=1`);
  }

  const intake = await getIntake(sessionId);
  if (!intake) {
    return NextResponse.redirect(`${appUrl}/?expired=1`);
  }

  // If a Stripe session already exists for this intake, reuse it.
  if (intake.stripeSessionId) {
    try {
      const existing = await getStripe().checkout.sessions.retrieve(intake.stripeSessionId);
      if (existing.status === "complete") {
        return NextResponse.redirect(`${appUrl}/?paid=1`);
      }
      if (existing.status === "open" && existing.url) {
        return NextResponse.redirect(existing.url);
      }
      // Fall through to creating a fresh session if the existing one is expired/abandoned.
    } catch (err) {
      console.error("[checkout/resume] failed to retrieve existing Stripe session", err);
      // Fall through to create a new one.
    }
  }

  // Create a new hosted-mode Stripe session so the email link lands on Stripe's
  // own page (embedded mode requires a client secret we can't deliver via redirect).
  const fresh = await createCheckoutSession({
    sessionId: intake.sessionId,
    urgency: intake.urgency,
    customerEmail: intake.clientEmail,
    returnUrlBase: appUrl,
    uiMode: "hosted",
  });

  await updateIntake(sessionId, { stripeSessionId: fresh.id });

  if (!fresh.url) {
    // Defensive: hosted-mode sessions always return a URL, but guard just in case.
    return NextResponse.redirect(`${appUrl}/?expired=1`);
  }

  return NextResponse.redirect(fresh.url);
}
```

> **Note:** the `createCheckoutSession` helper currently hard-codes `ui_mode: "embedded_page"` in its default. We pass `uiMode: "hosted"` here so the redirect works. Verify that Task 4's helper respects the override.

- [ ] **Step 2: Type-check**

Run:
```bash
npm run lint && npm run build
```

Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/checkout/resume/route.ts
git commit -m "feat(checkout): add resume endpoint for email payment link"
```

---

## Task 16: Create the Calendly webhook endpoint

**Files:**
- Create: `src/app/api/webhooks/calendly/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { getIntake } from "@/lib/intake";
import { sendBookingNotificationEmail } from "@/lib/resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CalendlyInviteePayload {
  event: string; // "invitee.created"
  payload: {
    name: string;
    email: string;
    uri: string; // invitee uri
    scheduled_event: {
      uri: string;
      start_time: string;
    };
    tracking?: {
      utm_content?: string;
    };
  };
}

// Calendly signs webhooks using HMAC-SHA256 over the raw request body,
// delivered in the `Calendly-Webhook-Signature` header with format:
//   t=<unix ts>,v1=<signature>
// We verify `v1` against HMAC(signingKey, `${t}.${body}`).
function verifySignature(rawBody: string, header: string | null, signingKey: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const [k, v] = kv.split("=");
      return [k.trim(), (v ?? "").trim()];
    })
  );
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;

  const expected = crypto
    .createHmac("sha256", signingKey)
    .update(`${t}.${rawBody}`)
    .digest("hex");

  // Use timingSafeEqual to avoid timing attacks.
  const a = Buffer.from(v1, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const signingKey = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
  if (!signingKey) {
    console.error("[calendly-webhook] CALENDLY_WEBHOOK_SIGNING_KEY not set");
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("calendly-webhook-signature");

  if (!verifySignature(rawBody, signature, signingKey)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let body: CalendlyInviteePayload;
  try {
    body = JSON.parse(rawBody) as CalendlyInviteePayload;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // We only care about invitee.created. Ignore other events with 200 so Calendly doesn't retry.
  if (body.event !== "invitee.created") {
    return NextResponse.json({ ok: true, ignored: body.event });
  }

  const invitee = body.payload;
  const sessionId = invitee.tracking?.utm_content ?? null;

  const intake = sessionId ? await getIntake(sessionId) : null;

  try {
    await sendBookingNotificationEmail({
      clientName: invitee.name,
      clientEmail: invitee.email,
      matterDescription: intake?.matterDescription,
      urgency: intake?.urgency,
      eventStartTime: invitee.scheduled_event.start_time,
      eventUri: invitee.scheduled_event.uri,
      inviteeUri: invitee.uri,
      stripeSessionId: intake?.stripeSessionId ?? null,
    });
  } catch (err) {
    console.error("[calendly-webhook] failed to send firm notification", err);
    // Still return 200 so Calendly doesn't retry on transient Resend hiccups.
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
npm run lint && npm run build
```

Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/webhooks/calendly/route.ts
git commit -m "feat(webhook): add Calendly invitee.created webhook with HMAC verification"
```

---

## Task 17: Add the `?expired=1` banner to the landing page

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Re-read the file**

Run:
```bash
cat src/app/page.tsx
```

- [ ] **Step 2: Add a client-side expired banner**

The simplest approach: read the `expired` search param on the server (pages are server components by default in App Router) and render a small banner above the chat widget. Add near the top of the default export:

```tsx
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string; paid?: string }>;
}) {
  const params = await searchParams;
  const expired = params.expired === "1";
  const paid = params.paid === "1";

  return (
    <main className="...existing classes...">
      {expired && (
        <div
          role="alert"
          className="mx-auto max-w-2xl p-3 m-4 rounded-lg border border-amber-300 bg-amber-50 text-sm text-amber-900"
        >
          Your previous session has expired. Please restart your inquiry from the chat below.
        </div>
      )}
      {paid && (
        <div
          role="status"
          className="mx-auto max-w-2xl p-3 m-4 rounded-lg border border-green-300 bg-green-50 text-sm text-green-900"
        >
          Payment already complete — thank you. We'll be in touch about scheduling.
        </div>
      )}
      {/* ...existing page content... */}
    </main>
  );
}
```

Preserve any existing JSX and classNames; only add the banner block and extend the component signature to accept `searchParams`.

> **If** the existing `page.tsx` is a client component (has `"use client"` at the top), read `expired` via `useSearchParams()` from `next/navigation` inside the component body instead.

- [ ] **Step 3: Type-check**

Run:
```bash
npm run lint && npm run build
```

Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(page): show expired/paid banners from resume link"
```

---

## Task 18: Add env var documentation

**Files:**
- Modify: `.env.example` (if it exists) OR create it; also check `README.md` / `CLAUDE.md` if they document env vars

- [ ] **Step 1: Check for existing env example**

Run:
```bash
ls -la .env* 2>/dev/null
```

- [ ] **Step 2: Append the new env vars**

Add to `.env.example` (create if missing), after existing entries:

```env
# Calendly booking integration
NEXT_PUBLIC_CALENDLY_BOOKING_URL=https://calendly.com/ekalaivan/advising-meeting
CALENDLY_BOOKING_URL=https://calendly.com/ekalaivan/advising-meeting
CALENDLY_WEBHOOK_SIGNING_KEY=
FIRM_NOTIFICATION_EMAIL=prabu@paretoid.com
```

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs(env): document Calendly and firm-notification env vars"
```

---

## Task 19: Manual smoke test — non-urgent happy path

This task has no code changes. It is a scripted manual test to run against a dev instance before declaring the feature done.

- [ ] **Step 1: Set env vars locally**

Ensure `.env.local` has:
- `RESEND_API_KEY`
- `STRIPE_SECRET_KEY` (test mode)
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- `NEXT_PUBLIC_URL=http://localhost:3000`
- `NEXT_PUBLIC_CALENDLY_BOOKING_URL=https://calendly.com/ekalaivan/advising-meeting`
- `CALENDLY_BOOKING_URL=https://calendly.com/ekalaivan/advising-meeting`
- `FIRM_NOTIFICATION_EMAIL=prabu@paretoid.com`
- `CALENDLY_WEBHOOK_SIGNING_KEY` (paste from Calendly webhook subscription setup — see Task 22)

- [ ] **Step 2: Start the dev server**

Run:
```bash
npm run dev
```

- [ ] **Step 3: Walk the non-urgent flow**

Open `http://localhost:3000` and:

1. Ask a criminal-law question (e.g., "What is bail?") — confirm `matchQuestion` responds.
2. Click "Yes, I'd like to book a session".
3. Provide name, email, phone, and a short matter description.
4. Pick **Non-urgent — $726** when prompted.
5. Confirm the chat continues and `selectUrgency` runs.
6. Check the inbox of the email you used — you should see "Your Legal Strategy Session inquiry" with a payment button and the non-urgent Calendly link.
7. Confirm "Yes, please proceed" → Stripe checkout embedded → pay with `4242 4242 4242 4242` / any future date / any CVC.
8. Skip or complete document upload.
9. Confirm the Calendly widget appears inline in the chat with your name and email prefilled and the matter showing in the first custom question.
10. Book a real slot on the test Calendly account.
11. Confirm the widget collapses to "Your session is confirmed." and the LLM sends a closing message.
12. Confirm `prabu@paretoid.com` receives a "Booking confirmed" email (this relies on the webhook — if the webhook isn't wired yet, skip this sub-step).

- [ ] **Step 4: Capture any regressions**

If any step fails, open a new task in this plan describing the failure and its fix. Commit the fix as its own commit before moving on.

---

## Task 20: Manual smoke test — urgent happy path

- [ ] **Step 1: Walk the urgent flow**

Repeat Task 19's setup. This time:

1. Answer a question and start the intake flow.
2. Pick **Urgent — $1,320**.
3. Confirm the client email arrives with the urgent tail: phone number and business hours.
4. Complete payment.
5. Skip/complete upload.
6. Confirm the `UrgentContactCard` renders with:
   - Phone number as a tappable link (on mobile, `tel:` should open the dialer; on desktop, href is inspected in dev tools).
   - Business hours line.
   - Outside-hours banner if you run the test outside 10am–5pm Sydney time.
7. Click "I've called".
8. Confirm the LLM sends the closing message for urgent.

- [ ] **Step 2: Capture regressions as above**

---

## Task 21: Manual test — payment resume from email link

- [ ] **Step 1: Trigger email without completing payment**

1. Run through steps 1–6 of Task 19 (non-urgent path), stopping after the email arrives.
2. Close the chat tab without clicking "Yes, please proceed".

- [ ] **Step 2: Click the "Complete payment" button in the email**

Expected: browser opens `http://localhost:3000/api/checkout/resume?session=...`, which creates a new hosted Stripe session and redirects to `https://checkout.stripe.com/...`. Pay with `4242 4242 4242 4242`.

- [ ] **Step 3: Verify the return flow**

Expected: Stripe redirects back to `http://localhost:3000/?payment=success&session_id=...`. Confirm no errors in the dev server logs.

- [ ] **Step 4: Click the email link again after payment**

Expected: resume endpoint sees `status === "complete"` and redirects to `/?paid=1`, showing the "Payment already complete" banner.

- [ ] **Step 5: Manually expire the intake record**

Run (replacing the session id):
```bash
# using redis-cli against Upstash directly, or the Upstash REST API
curl -X POST "$UPSTASH_REDIS_REST_URL/del/intake:SESSION_ID" \
  -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN"
```

Then click the email link again. Expected: redirect to `/?expired=1` with the amber banner.

---

## Task 22: Manual test — Calendly webhook signature verification

- [ ] **Step 1: Register the webhook with Calendly**

Run (replacing `YOUR_TOKEN`, `YOUR_ORG_URI`, and the callback URL — the URL must be reachable from the internet, so use a tunneling service like `ngrok` or `cloudflared tunnel` pointing at your dev server):

```bash
curl -X POST "https://api.calendly.com/webhook_subscriptions" \
  -H "Authorization: Bearer YOUR_CALENDLY_PERSONAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://YOUR_PUBLIC_TUNNEL/api/webhooks/calendly",
    "events": ["invitee.created"],
    "organization": "YOUR_ORG_URI",
    "scope": "organization",
    "signing_key": "GENERATE_A_RANDOM_STRING_HERE"
  }'
```

Save the `signing_key` you generated into `.env.local` as `CALENDLY_WEBHOOK_SIGNING_KEY`. Restart the dev server.

- [ ] **Step 2: Send an unsigned request — expect 401**

Run:
```bash
curl -i -X POST http://localhost:3000/api/webhooks/calendly \
  -H "Content-Type: application/json" \
  -d '{"event":"invitee.created","payload":{}}'
```

Expected: `HTTP/1.1 401 Unauthorized` with body `{"error":"invalid signature"}`.

- [ ] **Step 3: Send a signed request — expect 200 and a firm email**

Generate a valid signature from a shell and replay it (replace `$SIGNING_KEY`):

```bash
SIGNING_KEY="GENERATE_A_RANDOM_STRING_HERE"
BODY='{"event":"invitee.created","payload":{"name":"Test Visitor","email":"test@example.com","uri":"https://api.calendly.com/scheduled_events/XXX/invitees/YYY","scheduled_event":{"uri":"https://api.calendly.com/scheduled_events/XXX","start_time":"2026-04-15T03:00:00.000000Z"},"tracking":{"utm_content":"s_test_session"}}}'
TIMESTAMP=$(date +%s)
SIG=$(printf "%s.%s" "$TIMESTAMP" "$BODY" | openssl dgst -sha256 -hmac "$SIGNING_KEY" -hex | awk '{print $2}')

curl -i -X POST http://localhost:3000/api/webhooks/calendly \
  -H "Content-Type: application/json" \
  -H "Calendly-Webhook-Signature: t=${TIMESTAMP},v1=${SIG}" \
  -d "$BODY"
```

Expected: `HTTP/1.1 200 OK` with `{"ok":true}`, and a "Booking confirmed — Test Visitor" email lands in `prabu@paretoid.com`.

- [ ] **Step 4: End-to-end webhook from a real Calendly booking**

With the tunnel active, book a real slot through the chat widget's non-urgent flow. Watch the dev server logs for the webhook hit. Confirm the firm notification email arrives.

---

## Task 23: Final pass — verify, commit, and push

- [ ] **Step 1: Run full verification**

```bash
npm run lint && npm run build
```

Expected: both pass. No new warnings introduced.

- [ ] **Step 2: Check `git status` is clean**

```bash
git status
git log --oneline -25
```

Expected: working tree clean; recent commits cleanly tell the story of the feature.

- [ ] **Step 3: Ask the user whether to open a PR**

Do not push or open a PR without explicit user confirmation. Present the commit log and wait for the user to approve next steps.

---

## Self-review (already applied — no action required)

The following checks were performed while drafting this plan:

1. **Spec coverage:** Every section of the spec (new tools, components, email, webhook, resume endpoint, intake record, system prompt, env vars, testing) has at least one corresponding task.
2. **Placeholder scan:** No `TBD`, `TODO`, or "add error handling" stubs. Code blocks are complete and directly pastable.
3. **Type consistency:** `scheduleAppointment` / `showUrgentContact` tool output schemas, `IntakeRecord` shape, `CreateCheckoutSessionArgs`, and `CalendlyEmbed` props all use consistent field names across tasks. `onBooked` returns `{ eventStartTime, eventUri, inviteeUri }` in both the component and the widget callback; `ChatWidget.handleScheduleBooked` relays those to `addToolOutput` under the same keys.
4. **Known deferral:** `eventStartTime` in the postMessage payload is intentionally set to an empty string in the client — the authoritative start time comes from the Calendly webhook to the firm email. The chat UI shows a generic "Your session is confirmed" confirmation instead of the exact time, avoiding the need for a second Calendly REST call. Accepted trade-off, documented in the spec.
