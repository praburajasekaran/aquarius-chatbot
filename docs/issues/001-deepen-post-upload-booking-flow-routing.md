# Deepen post-upload booking flow routing

## What to build

Create a deep booking flow module for the post-payment path. Given a `sessionId` and a completed document-upload action, the module should decide the next booking step from the saved intake record and return either the Calendly booking step for non-urgent matters or the urgent contact step for urgent matters.

## Problem

The post-payment booking flow is currently split between LLM prompt rules, client transcript mutation, AI SDK tool state, and server intake lookup. The recent “Documents submitted but no Calendly” bug happened because no single module owned the transition from document upload to Calendly booking or urgent contact.

## Solution

Create a booking flow module whose interface is: given `sessionId` and completed client action, return the next booking step. Keep transcript/tool-part details inside the implementation so callers do not need to know how Calendly or urgent contact are represented in chat state.

## Resolved design decisions

- The canonical boundary is a domain/app-level post-upload booking decision plus a chat adapter.
- The trigger is specifically document upload resolution: either one or more files uploaded, or the visitor explicitly skips upload.
- The module assumes it is called from the post-payment upload path. It routes from the saved intake record and does not re-verify payment.
- The domain result shape should distinguish:
  - `session-booking` for non-urgent paid intakes.
  - `urgent-contact` for urgent paid intakes.
  - `unavailable` for missing or invalid intake.
- Missing intake and invalid intake should be distinct internal reasons, but browser/user-facing fallback can stay generic.
- Invalid intake must never default to Calendly. Unknown/missing urgency is invalid. For `session-booking`, missing name or email is invalid; phone and matter summary are not required.
- The urgent contact step stays session-only.
- Use **Session Booking Step** as the domain term. Calendly is the current rendering/integration, not the domain name.
- The API route should return domain-level step data. The chat-side adapter converts that step to AI SDK tool parts or fallback text.
- Keep the existing `/api/intake/[sessionId]/next-step` path for this issue; improve internal names/types instead of renaming the public endpoint.
- Keep the deterministic module read-only and idempotent. Duplicate card prevention belongs in chat state/rendering logic.
- Keep the system prompt's post-upload routing rule as a fallback/consistency guardrail, but app code owns the transition.
- Direct Calendly URL fallback is allowed only after the visitor is safely known to be non-urgent. If urgency is unknown, show firm contact fallback only.
- The domain step does not carry the Calendly URL. The chat adapter/rendering layer uses `NEXT_PUBLIC_CALENDLY_BOOKING_URL` when it needs a direct link fallback.
- Test split:
  - Domain module tests cover non-urgent, urgent, missing intake, and invalid intake.
  - Chat adapter tests cover `session-booking`, `urgent-contact`, and unavailable fallback rendering.
  - Widget tests assert upload resolution flows through the module/adapter boundary instead of duplicating booking-step construction.
  - Route tests stay thin and verify serialization/boundary behavior rather than duplicating all domain cases.

## Acceptance criteria

- [ ] Non-urgent payment followed by document upload renders the Calendly booking step without relying on model continuation.
- [ ] Urgent payment followed by document upload renders the urgent contact step without relying on model continuation.
- [ ] The booking flow module has focused tests for non-urgent, urgent, missing intake, and invalid intake states.
- [ ] Chat UI tests assert behavior through the module interface, not by duplicating booking-step construction in the widget.
- [ ] Existing user-visible chat behavior is preserved.

## Blocked by

None - can start immediately.
