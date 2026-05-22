/**
 * DCEM (Designated Commercial Electronic Message) — Spam Act 2003 s.6(1)
 *
 * These email bodies are FACTUAL service notifications, NOT promotional messages.
 * They re-engage a recipient who has already shown intent (started an inquiry,
 * received a fee quote, did not complete payment) and direct them back to a
 * specific transactional next step they have already begun.
 *
 * DO NOT add:
 *   - Promotional language ("best", "trusted", "award-winning", "act now")
 *   - Adjectives describing the firm's services or success rates
 *   - Calls-to-action for additional services unrelated to the original inquiry
 *   - "Reply STOP" / mailto: opt-out instructions — the one-click unsubscribe
 *     link IS the opt-out mechanism (HMAC-signed per INFRA-07). Including
 *     "Reply STOP" would mislead the recipient and offer a channel we do not
 *     monitor.
 *
 * Any change to these strings requires written sign-off from the firm
 * principal before deployment. See COMP-01 / COMP-02 in REQUIREMENTS.md.
 *
 * Until firm-principal sign-off lands, the locked-copy fields below export
 * the sentinel string `PENDING_SIGNOFF`. The runtime guard
 * `assertCopyApproved()` (called from the route handler before Resend
 * dispatch) throws in production builds when any field is still
 * `PENDING_SIGNOFF`, failing loud rather than silently sending placeholders.
 */

export const PENDING_SIGNOFF = "PENDING_SIGNOFF" as const;

// Subject lines (factual, transactional)
export const PAYMENT_1H_SUBJECT: string = PENDING_SIGNOFF;
export const PAYMENT_24H_SUBJECT: string = PENDING_SIGNOFF;

// Body text (returned by string-builder fns to allow templated insertion of
// clientName, snippet, resumeUrl). Until sign-off, both functions return
// the PENDING_SIGNOFF sentinel.
export const PAYMENT_1H_BODY: (params: {
  clientName: string;
  matterSnippet: string;
  resumeUrl: string;
  unsubscribeUrl: string;
}) => string = () => PENDING_SIGNOFF;

export const PAYMENT_24H_BODY: (params: {
  clientName: string;
  matterSnippet: string;
  resumeUrl: string;
  unsubscribeUrl: string;
}) => string = () => PENDING_SIGNOFF;

// LSS explainer block (rendered in 1h hybrid only) — side-by-side tier table
// content per Decision 1. Each field carries the PENDING_SIGNOFF sentinel
// until firm-principal sign-off.
export const LSS_EXPLAINER_BLOCK: {
  urgentTitle: string;
  urgentPrice: string;
  urgentDescription: string;
  urgentNextStep: string;
  nonUrgentTitle: string;
  nonUrgentPrice: string;
  nonUrgentDescription: string;
  nonUrgentNextStep: string;
} = {
  urgentTitle: PENDING_SIGNOFF,
  urgentPrice: PENDING_SIGNOFF,
  urgentDescription: PENDING_SIGNOFF,
  urgentNextStep: PENDING_SIGNOFF,
  nonUrgentTitle: PENDING_SIGNOFF,
  nonUrgentPrice: PENDING_SIGNOFF,
  nonUrgentDescription: PENDING_SIGNOFF,
  nonUrgentNextStep: PENDING_SIGNOFF,
};

// The unsubscribe label is utility text and does NOT carry the
// PENDING_SIGNOFF gate (it's a functional UI label, not promotional copy —
// same logic as v1.0 SMS omitting "Reply STOP": the opt-out mechanism is
// structural, not editorial).
export const UNSUBSCRIBE_LINK_LABEL = "Unsubscribe from these reminders";

/**
 * Production guard — throws if any locked-copy field is still PENDING_SIGNOFF
 * when NODE_ENV === "production". Called by the route handler (Plan 04-03)
 * BEFORE Resend dispatch, so a missing sign-off fails loud rather than
 * silently sending placeholders.
 *
 * Outside production (test, dev, CI without NODE_ENV=production) the guard
 * is a no-op so unit tests and PR previews continue to function with
 * placeholder copy.
 */
export function assertCopyApproved(): void {
  if (process.env.NODE_ENV !== "production") return;
  const pending: string[] = [];
  if (PAYMENT_1H_SUBJECT === PENDING_SIGNOFF) pending.push("PAYMENT_1H_SUBJECT");
  if (PAYMENT_24H_SUBJECT === PENDING_SIGNOFF) pending.push("PAYMENT_24H_SUBJECT");
  // For string-builder fns, invoke with empty params and check return value.
  const dummy = {
    clientName: "",
    matterSnippet: "",
    resumeUrl: "",
    unsubscribeUrl: "",
  };
  if (PAYMENT_1H_BODY(dummy) === PENDING_SIGNOFF) pending.push("PAYMENT_1H_BODY");
  if (PAYMENT_24H_BODY(dummy) === PENDING_SIGNOFF) pending.push("PAYMENT_24H_BODY");
  if (LSS_EXPLAINER_BLOCK.urgentTitle === PENDING_SIGNOFF) {
    pending.push("LSS_EXPLAINER_BLOCK");
  }
  if (pending.length > 0) {
    throw new Error(
      `[email-reminder] Copy not signed off: ${pending.join(", ")}. ` +
        `Update src/lib/email-reminders/copy.ts with firm-principal-approved strings before production deploy. ` +
        `See COMP-01 / Decision 1 in 04-CONTEXT.md.`
    );
  }
}
