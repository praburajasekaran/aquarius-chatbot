# Aquarius Chatbot

This context describes the booking language used by the Aquarius Lawyers chatbot after a visitor has paid for a Legal Strategy Session.

## Language

**Post-Upload Booking Step**:
The next booking instruction shown to a paid visitor after they complete or skip document upload.
_Avoid_: next-step route, tool part, chat message

**Session Booking Step**:
The post-upload booking step that lets a non-urgent paid visitor choose a Legal Strategy Session time.
_Avoid_: Calendly route, schedule tool

**Urgent Contact Step**:
The post-upload booking step that directs an urgent paid visitor to contact the firm immediately.
_Avoid_: urgent route, contact tool

**Document Upload Resolution**:
The visitor's completion of the document upload prompt, either by uploading files or explicitly skipping because they have none.
_Avoid_: successful upload, file submission

**Matter Summary**:
A brief description of the visitor's legal matter captured during intake.
_Avoid_: matter description, Calendly answer

**Paid Intake**:
A visitor intake whose Legal Strategy Session payment has already been accepted.
_Avoid_: payment session, checkout record

**Invalid Intake**:
A visitor intake that lacks urgency or, for a session booking step, the visitor name or email needed to present booking.
_Avoid_: missing intake, bad route

**Missing Intake**:
The absence of a saved visitor intake for a session that is expected to have one.
_Avoid_: invalid intake, bad route

## Relationships

- A **Document Upload Resolution** may include zero or more uploaded files.
- A **Paid Intake** reaches exactly one **Post-Upload Booking Step** after a **Document Upload Resolution**.
- A **Post-Upload Booking Step** is either a **Session Booking Step** or an **Urgent Contact Step**.
- A **Session Booking Step** may include a **Matter Summary**, but does not require one.
- An **Invalid Intake** does not produce a Calendly booking step by default.
- A **Missing Intake** and an **Invalid Intake** are different failures even when the visitor-facing fallback is the same.

## Example dialogue

> **Dev:** "Should the chat widget decide whether to show Calendly or urgent contact after upload?"
> **Domain expert:** "No — it asks for the **Post-Upload Booking Step** and renders that result through the chat adapter."
> **Dev:** "If the visitor skips upload because they have no documents, do we still show the booking step?"
> **Domain expert:** "Yes — skipping is still a **Document Upload Resolution**."
> **Dev:** "Does the booking step decision re-check payment?"
> **Domain expert:** "No — it is only used once there is already a **Paid Intake**."
> **Dev:** "If urgency is missing from the saved intake, should we assume non-urgent?"
> **Domain expert:** "No — that is an **Invalid Intake** and must not default to Calendly."
> **Dev:** "If there is no saved intake at all, is that the same as malformed data?"
> **Domain expert:** "No — that is a **Missing Intake**, not an **Invalid Intake**."
> **Dev:** "Is Calendly part of the domain step name?"
> **Domain expert:** "No — the visitor reaches a **Session Booking Step**; Calendly is how that step is currently rendered."
> **Dev:** "Does the scheduler need the visitor's phone number?"
> **Domain expert:** "No — the **Session Booking Step** needs name and email; phone remains part of the broader intake."

## Flagged ambiguities

- "booking flow module" could mean either a domain decision module or a chat-message builder — resolved: it decides the **Post-Upload Booking Step**, while a chat adapter handles chat representation.
