# Confirm Smokeball matter creation via tail callback

Paid intake fan-out sends a create-matter request to Zapier. Zapier accepting the webhook only proves Zapier received the request; it does not prove Smokeball created the matter or expose the resulting Smokeball matter ID.

Therefore the app treats Zapier acceptance as best-effort delivery and treats Zapier's tail callback to `/api/webhooks/smokeball-matter-created` as the confirmation that a Smokeball matter exists. The callback stores the session-to-SmokeBall matter mapping used by later document upload flows.

Client payment completion must not wait on Smokeball matter creation. If the callback never arrives, the paid intake still completes, and later document delivery degrades to manual reconciliation using the session reference.

Booking-specific appointment notes require a Smokeball matter ID. If Calendly confirms a booking before the callback mapping exists, the app should retry for a short window. If the mapping still does not arrive, the booking remains confirmed and the app surfaces the appointment note as a manual follow-up instead of attaching it to an ambiguous matter.

The app should not add long-running retries for the initial create-matter Zap until the Zapier/Smokeball side has a confirmed idempotency guard keyed by matter reference. The existing immediate webhook retry is acceptable; durable retry without dedupe risks duplicate Smokeball matters.

The app sends a deterministic matter title to Zapier. The title combines the visitor's name with a three-to-four-word title summary derived from the matter summary by removing filler and preserving the visitor's useful words where possible. The initial implementation should not use an AI model for this title because title creation runs in payment fan-out and should be predictable, fast, and easy to debug.

The initial create-matter payload should include the matter summary but not the full chat transcript. The transcript remains in the firm notification email unless the firm later decides that full transcripts should be added to Smokeball as a separate note or document.

The app should alert the firm only on hard integration failures, such as the create-matter Zap failing after the immediate retry or an appointment note still lacking a Smokeball matter mapping after its retry window. A missing callback during normal Zapier delay should be logged but should not immediately notify the firm.

Firm-facing integration alerts should be sent by email rather than through the Zapier audit Zap, because Zapier may be the failing dependency. Structured logs remain useful for debugging and dashboards.
