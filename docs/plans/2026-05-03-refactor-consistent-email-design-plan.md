---
title: Use consistent design for all email notifications
type: refactor
date: 2026-05-03
---

# Use consistent design for all email notifications

## Overview

The chatbot currently sends ~7 distinct notification emails through three different rendering paths — inline HTML strings, one React Email component, and raw plaintext. Visual treatment drifts across all of them: logo presence, container widths, border colours (`#ddd` vs `#e5e5e5`), brand button colours, footer copy, and greeting style are all inconsistent. Standardise every send on a single React Email design system anchored on the existing `PaymentReceipt` component, with a shared `EmailLayout` (logo header, container, footer) used by both client-facing and firm-internal emails.

## Problem Statement / Motivation

A client who pays today receives:
1. A polished React Email receipt ([src/lib/email/payment-receipt.tsx](src/lib/email/payment-receipt.tsx)) — white card on `#f6f8fa`, brand button, no logo.
2. (Earlier in the flow) An inquiry email ([src/lib/resend.ts:105](src/lib/resend.ts:105)) — different inline HTML, has logo, different table border, has footer.
3. (After uploading docs) A bare plaintext "We received a file" email ([src/lib/late-upload/handle-completed.ts:183](src/lib/late-upload/handle-completed.ts:183)) — zero branding.

Concretely, the firm sends emails with:

| File | Sender | Render | Logo | Wrapper | Table border | Footer | Greeting |
|------|--------|--------|------|---------|--------------|--------|----------|
| [resend.ts:56](src/lib/resend.ts:56) | `sendTranscriptEmail` (firm) | inline HTML | ✓ | ✗ | `#ddd` | ✗ | n/a |
| [resend.ts:105](src/lib/resend.ts:105) | `sendClientInquiryEmail` (client) | inline HTML | ✓ | ✓ | `#e5e5e5` | ✓ | "Hi {name}," |
| [resend.ts:197](src/lib/resend.ts:197) | `sendFirmLeadEmail` (firm) | inline HTML | ✓ | ✗ | `#ddd` | ✗ | n/a |
| [resend.ts:247](src/lib/resend.ts:247) | `sendBookingNotificationEmail` (firm) | inline HTML | ✓ | ✓ | `#e5e5e5` | ✗ | n/a |
| [intake/handle-paid.ts:156](src/lib/intake/handle-paid.ts:156) | `PaymentReceipt` (client) | React Email | **✗** | ✓ | n/a | partial | "Hi {name},"/"Hello," |
| [late-upload/handle-completed.ts:149](src/lib/late-upload/handle-completed.ts:149) | late-upload firm notify | **plaintext** | ✗ | ✗ | n/a | ✗ | n/a |
| [late-upload/handle-completed.ts:183](src/lib/late-upload/handle-completed.ts:183) | late-upload client notify | **plaintext** | ✗ | ✗ | n/a | ✗ | "Hi {name}," |

This weakens trust on the most security-sensitive touchpoint (the upload-link confirmation arrives as a plaintext email easily mistaken for spam), and makes any future change — e.g. updating the firm logo, swapping the brand colour, adding a "Reply STOP" line — a 7-file shotgun edit instead of a one-file change.

## Proposed Solution

Adopt **React Email components** as the single rendering path for every notification, anchored on a new shared `<EmailLayout>` component derived from the existing `PaymentReceipt` styles. Every email — client-facing or firm-internal — flows through the same header (logo), container (white card, 560px max-width on `#f6f8fa`), typography scale, button styles, and footer copy. Content varies; chrome does not.

**Decisions confirmed during brainstorming:**
- **Render approach:** React Email components for all 7 senders (no inline HTML, no plaintext).
- **Firm vs client:** Same visual design — firm internal emails get the same wrapper/logo/footer; only the body content differs.
- **Visual baseline:** Use `PaymentReceipt` as reference; add the missing logo header and extract its tokens into shared style modules.

## Technical Considerations

### Architecture

- New `src/lib/email/components/` directory holds reusable building blocks (`EmailLayout`, `Logo`, `DataTable`, `BrandButton`, `Footer`).
- Each existing sender becomes a thin React Email component file in `src/lib/email/templates/` that composes those building blocks.
- `src/lib/resend.ts` send functions stop assembling HTML strings — they accept already-rendered template props and pass `react: <Template {...props} />` to `sendAndLog`.
- `BRANDING.emailLogoHtml` getter (currently a raw HTML string) is replaced by a `<Logo />` React Email component reading the same env vars.

### Design Tokens

Extract a single `src/lib/email/styles.ts` module with the existing PaymentReceipt tokens, so a future colour/spacing change touches one file:

```ts
// src/lib/email/styles.ts
export const tokens = {
  colors: {
    background: "#f6f8fa",
    surface: "#ffffff",
    text: "#1a1a1a",
    textMuted: "#555555",
    textFaint: "#777777",
    border: "#e5e5e5",
    brand: "#61BBCA",          // matches --color-brand in globals.css
    brandAccessible: "#085a66", // matches --color-brand-accessible (AAA contrast)
  },
  fonts: {
    sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
  spacing: { container: "560px", padding: "32px" },
} as const;
```

Border colour standardises on `#e5e5e5` (PaymentReceipt's choice; the `#ddd` variants are dropped). Brand colour stays `#61BBCA` for primary actions; `#085a66` (AAA-accessible) reserved for secondary actions and inline links.

### Backwards Compatibility

- `BRANDING.emailLogoHtml` remains exported for one release cycle to avoid breaking any external references, but is marked `@deprecated`. After all senders migrate, it's removed.
- Subject line format is normalised (see Step 6 below) — Resend itself doesn't care, but inboxes that thread on subject will start a new thread on the first send post-deploy. Acceptable.

### Email Client Compatibility

React Email handles MSO/Outlook quirks via its components, but the `<Logo>` component must:
- Inline width/height attributes (not just CSS) — Outlook strips CSS sizing on `<img>`.
- Use `display:block` + `border:0` to prevent Outlook's default link border.
- Resolve `NEXT_PUBLIC_FIRM_LOGO_URL` to an absolute URL (relative paths don't load in any client).

The plaintext `text:` fallback (Resend auto-generates one when only `react` is provided, but quality varies) should be supplied explicitly for the upload-confirmation email — that's the one a recipient might forward to IT for verification.

### Migration Order

Migrate in dependency order so each step is independently verifiable:
1. Build `EmailLayout` + tokens + `<Logo>` + `<DataTable>` + `<Footer>`.
2. Update `PaymentReceipt` to use `EmailLayout` (gains the missing logo).
3. Port `sendClientInquiryEmail` (client) — already most similar to target design.
4. Port `sendBookingNotificationEmail` (firm).
5. Port `sendTranscriptEmail` + `sendFirmLeadEmail` (both firm, similar shape).
6. Convert the two late-upload plaintext sends to React Email templates.
7. Normalise subject lines.
8. Delete `BRANDING.emailLogoHtml`.

## Acceptance Criteria

- [x] All 7 email senders pass `react:` to `sendAndLog` — `grep -rn "html:" src/lib/resend.ts src/lib/late-upload src/lib/intake` returns no matches inside `sendAndLog` payloads.
- [x] Every rendered email (client and firm) includes the firm logo header, the same 560px white card on `#f6f8fa`, and the standard footer.
- [x] `src/lib/email/components/` exports `EmailLayout`, `Logo`, `BrandButton`, `DataTable`, `Footer`. Every template imports the layout — no template defines its own `<Body>`/`<Container>`.
- [x] `src/lib/email/styles.ts` is the single source of email design tokens. No hex colours appear inline in any template file.
- [x] `BRANDING.emailLogoHtml` is removed from [src/lib/branding.ts](src/lib/branding.ts).
- [x] Border colour is `#e5e5e5` everywhere; no `#ddd` table borders remain in `src/lib/email/`.
- [x] Subject lines follow the convention defined in Step 6 below (verified by snapshot test or inspection of all 7 senders).
- [x] `npm run build` and `npm run lint` pass.
- [ ] Manual smoke test: trigger each of the 7 emails in a dev environment (or render via React Email preview) and confirm visual consistency — same logo, same card, same footer.

## Implementation Plan

### Step 1 — Create shared layout components

#### src/lib/email/styles.ts (new)
Extract tokens (see Technical Considerations).

#### src/lib/email/components/Logo.tsx (new)
```tsx
// React Email-compatible logo component.
// Resolves logo URL from env (NEXT_PUBLIC_FIRM_LOGO_URL or fallback /aquarius-logo.jpg)
// to an absolute URL using NEXT_PUBLIC_URL. Inline width/height for Outlook.
```

#### src/lib/email/components/EmailLayout.tsx (new)
```tsx
// Wraps children in <Html><Head><Preview><Body><Container>.
// Renders <Logo /> at top and <Footer /> at bottom.
// Props: { preview: string; children: React.ReactNode; showFooter?: boolean }
// Default showFooter=true; firm-internal templates may opt out only if the
// content is purely operational data (we will keep it on for consistency).
```

#### src/lib/email/components/DataTable.tsx (new)
```tsx
// Renders an array of { label: string; value: ReactNode } rows as a 2-col
// table with tokens.colors.border. Replaces the four hand-rolled table
// blocks across the existing senders.
```

#### src/lib/email/components/BrandButton.tsx (new)
```tsx
// Wraps React Email <Button> with brand and brandAccessible variants.
// Props: { href: string; variant?: "primary" | "secondary"; children: ReactNode }
```

#### src/lib/email/components/Footer.tsx (new)
```tsx
// Renders Hr + small-text paragraph using BRANDING.emailFooter.
```

### Step 2 — Update PaymentReceipt to use EmailLayout

#### src/lib/email/payment-receipt.tsx (edit)
- Replace bespoke `<Body>`/`<Container>` with `<EmailLayout preview="…">`.
- Replace local `body`, `container`, `heading`, `button`, `callButton`, `divider`, `footer` style consts with token references / `<BrandButton>` / `<DataTable>`.
- Logo now appears automatically via `EmailLayout`.

### Step 3 — Port sendClientInquiryEmail

#### src/lib/email/templates/client-inquiry.tsx (new)
Component mirrors current HTML in [resend.ts:174-194](src/lib/resend.ts:174) using `EmailLayout`, `DataTable` (Matter / Urgency / Fee rows), `BrandButton` (Complete payment), and conditional urgent/non-urgent paragraph blocks.

#### src/lib/resend.ts (edit)
`sendClientInquiryEmail` becomes:
```ts
return sendAndLog({
  from, to: clientEmail,
  subject: `Your ${subjectMatterLabel} inquiry — ${BRANDING.firmName}`,
  react: ClientInquiryEmail({ clientName, clientEmail, matterDescription, urgency, displayPrice, resumeUrl, calendlyPrefillUrl }),
}, { event: "sendClientInquiryEmail", sessionId });
```

### Step 4 — Port sendBookingNotificationEmail

#### src/lib/email/templates/firm-booking-notification.tsx (new)
DataTable rows: Client / Email / Urgency? / Matter? / Start time / Calendly event / Calendly invitee / Stripe session?. Conditional rows handled inside the template.

#### src/lib/resend.ts (edit)
`sendBookingNotificationEmail` switches to `react:` prop.

### Step 5 — Port sendTranscriptEmail + sendFirmLeadEmail

#### src/lib/email/templates/firm-transcript.tsx (new)
Same DataTable shape as today plus the optional transcript block (use `<Section>` with monospace font from tokens).

#### src/lib/email/templates/firm-lead.tsx (new)
DataTable rows + a "Payment not yet completed" notice paragraph + payment-link button.

#### src/lib/resend.ts (edit)
Both functions switch to `react:` prop. Delete the old inline HTML strings.

### Step 6 — Convert late-upload plaintext to React Email

#### src/lib/email/templates/firm-upload-notification.tsx (new)
Replaces the plaintext firm notify in [late-upload/handle-completed.ts:149](src/lib/late-upload/handle-completed.ts:149). DataTable: Client / Matter ref / Smokeball matter ID / File / Size / URL / Smokeball Zap status / Uploaded at. Manual-required state surfaces as a red banner above the table.

#### src/lib/email/templates/client-upload-confirmation.tsx (new)
Replaces the plaintext client confirm in [late-upload/handle-completed.ts:183](src/lib/late-upload/handle-completed.ts:183). Short body — "We just received '{fileName}' for your matter." + standard footer + tripwire warning ("If this wasn't you, reply immediately").

#### src/lib/late-upload/handle-completed.ts (edit)
Both `sendAndLog` calls switch from `text:` to `react:`. Provide explicit `text:` fallback for the client confirmation (forwarding-to-IT case).

### Step 7 — Normalise subject lines

Standardise on the pattern: `{Action verb in present tense} — {client name | matter ref}` for firm emails, and `{Action} — {Firm name}` for client emails.

| Old | New |
|-----|-----|
| `New {urgency} Criminal Law Inquiry — {name}` | `New inquiry — {name} ({urgency})` |
| `New {urgency} inquiry — {name} (awaiting payment)` | `New lead — {name} (awaiting payment)` |
| `Booking confirmed — {name} — {time}` | `Booking confirmed — {name} ({time})` |
| `[Upload — MANUAL REQUIRED] {name} — {file}` | `Upload received — {name} ({file})` (manual-required surfaced in body, not subject) |
| `Your payment receipt — {firm}` | unchanged |
| `Your {label} inquiry — {firm}` | unchanged |
| `We received a file for your matter` | `Upload received — {firm}` |

### Step 8 — Delete deprecated branding helper

#### src/lib/branding.ts (edit)
Remove `emailLogoHtml` getter once no callers remain (`grep -r emailLogoHtml src` returns empty).

## Success Metrics

- **Single-file design changes:** changing the firm logo, brand colour, or footer copy touches exactly one file (`Logo.tsx`, `styles.ts`, or `Footer.tsx` respectively) — measurable by `git log --name-only` on a future change.
- **Zero inline HTML:** `grep -rn "html: \`" src/lib/resend.ts src/lib/late-upload src/lib/intake` returns empty.
- **Visual parity:** side-by-side rendering of all 7 emails (via React Email preview server, `npx react-email dev`) shows identical chrome.
- **No regressions:** existing tests for the email helpers still pass; `sendAndLog` event logging unchanged.

## Dependencies & Risks

**Dependencies**
- `@react-email/components` is already in use by `PaymentReceipt` — no new packages required.
- Resend SDK already supports the `react:` field — no API changes.

**Risks**
- **Outlook/Gmail rendering drift.** React Email mitigates most of this, but the new `<Logo>` and `<DataTable>` components must be smoke-tested in at least Apple Mail, Gmail (web), and Outlook. Mitigation: use React Email's preview server during development, screenshot in three clients before merge.
- **Plaintext fallback quality.** Resend auto-generates plaintext from rendered HTML, but it can include CSS noise. For the upload-confirmation email (highest-risk forward-to-IT scenario), supply an explicit `text:` field.
- **Deliverability regression.** Adding logo `<img>` tags can shift spam scoring marginally. Mitigation: keep logo `<img>` lightweight (the existing 180px width is already conservative), keep the assert-no-tracking guard ([src/lib/email/assert-no-tracking.ts](src/lib/email/assert-no-tracking.ts)) intact.
- **Subject-line threading.** Inboxes thread by subject; first email after deploy starts a new thread for the firm. Cosmetic, not functional. No mitigation needed.
- **Logo URL resolution in serverless.** `NEXT_PUBLIC_URL` must be set in production for the absolute logo URL to work. The current `BRANDING.emailLogoHtml` already depends on this; no new failure mode.

## References

### Internal
- Existing baseline: [src/lib/email/payment-receipt.tsx](src/lib/email/payment-receipt.tsx)
- All current senders: [src/lib/resend.ts](src/lib/resend.ts), [src/lib/intake/handle-paid.ts:140](src/lib/intake/handle-paid.ts:140), [src/lib/late-upload/handle-completed.ts:140](src/lib/late-upload/handle-completed.ts:140)
- Branding helpers: [src/lib/branding.ts](src/lib/branding.ts)
- Brand colour tokens: [src/app/globals.css:4](src/app/globals.css:4)
- Resend chokepoint contract: [src/lib/resend.ts:24](src/lib/resend.ts:24)
- Tracking-disable guard (do not break): [src/lib/email/assert-no-tracking.ts](src/lib/email/assert-no-tracking.ts)

### External
- React Email components docs: https://react.email/docs/components/html
- Resend `react:` field: https://resend.com/docs/send-with-nextjs
- Email client CSS support reference: https://www.caniemail.com/

### Related Plans
- Logo originally added in PR #57 (commit `ca17a34` — feat(email): add Aquarius Lawyers logo to email notifications). This refactor consolidates that work.
