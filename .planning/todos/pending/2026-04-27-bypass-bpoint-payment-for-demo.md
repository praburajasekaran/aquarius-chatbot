---
created: 2026-04-27T08:41:14.408Z
title: Bypass Bpoint payment for demo
area: payments
files:
  - src/lib/tools/initiate-payment.ts
  - src/app/api/checkout/route.ts
  - src/components/payment/payment-card.tsx
  - src/lib/stripe.ts
---

## Problem

Bpoint Checkout integration is taking longer than expected to get enabled, but we still need to demo the full chatbot flow to the client. Without a working payment step, the demo cannot show the end-to-end user journey (intake → quote → payment → confirmation/CRM handoff).

## Solution

Add a temporary demo bypass for the payment step:

- Skip the actual Bpoint (Stripe) payment call
- Show a simulated "payment success" message in the chat UI
- Continue the downstream flow as if payment succeeded (receipt email, Smokeball/Zapier handoff, session state transition)

Approach hints:
- Gate behind an env flag (e.g. `DEMO_BYPASS_PAYMENT=true`) so it's easy to disable once Bpoint is live
- Likely touchpoints: `src/lib/tools/initiate-payment.ts`, `src/app/api/checkout/route.ts`, `src/components/payment/payment-card.tsx`
- Make sure session/state still advances correctly post-"payment" so the rest of the demo flow works
- Clearly log/mark this as a demo path so it's easy to find and remove

Remove this bypass once Bpoint Checkout is enabled.
