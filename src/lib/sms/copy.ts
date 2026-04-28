import { FIRM_CONTACT } from "@/lib/contact";

/**
 * DCEM (Designated Commercial Electronic Message) — Spam Act 2003 s.6(1)
 *
 * These SMS bodies are FACTUAL service notifications, NOT promotional messages.
 * They confirm an action the recipient has already taken (paid, started a matter)
 * and direct them to complete the next step.
 *
 * DO NOT add:
 *   - Promotional language ("best", "trusted", "award-winning", "book now")
 *   - Adjectives describing the firm's services
 *   - Calls-to-action for additional services
 *   - "Reply STOP" — the sender ID is a one-way alpha-tag; ClickSend manages
 *     opt-outs platform-side via its own opt-out list. Including "Reply STOP"
 *     would mislead the recipient and waste character budget.
 *
 * Any change to these strings requires written sign-off from the firm
 * principal before deployment. See COMP-01 / COMP-02 in REQUIREMENTS.md.
 */

const FIRM_NAME = "Aquarius Lawyers";

export const IMMEDIATE_SMS_COPY = (uploadLink: string): string =>
  `${FIRM_NAME}: Your payment is confirmed. Please upload your documents here: ${uploadLink} — ${FIRM_NAME} ${FIRM_CONTACT.phone}`;

export const REMINDER_SMS_COPY = (uploadLink: string): string =>
  `${FIRM_NAME}: A reminder to upload your documents to complete your matter: ${uploadLink} — ${FIRM_NAME} ${FIRM_CONTACT.phone}`;

/**
 * Internal staff notification — firm-to-firm SMS sent to the on-call mobile
 * (FIRM_NOTIFY_PHONE) when an URGENT intake completes payment. Not subject
 * to DCEM: the firm is both sender and recipient. Kept factual + concise so
 * it fits in a single 160-char SMS segment with the client's callback number
 * front-and-centre.
 */
export const URGENT_FIRM_SMS_COPY = (
  clientName: string,
  clientPhone: string
): string =>
  `${FIRM_NAME}: URGENT paid matter — ${
    clientName || "(name unknown)"
  } (${clientPhone || "no phone"}). Check email for details.`;
