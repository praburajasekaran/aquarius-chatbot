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

**In-Chat Document Upload**:
A document upload completed inside the active chat session before the visitor reaches the post-upload booking step.
_Avoid_: late upload, Smokeball attachment, file storage event

**Manual Attachment Fallback**:
A firm-facing fallback that gives the firm access to uploaded documents when automatic attachment to a Smokeball matter is not confirmed.
_Avoid_: fallback storage, client file retrieval, backup database

**Matter Summary**:
A brief description of the visitor's legal matter captured during intake.
_Avoid_: matter description, Calendly answer

**Matter Title**:
A short firm-facing label for a matter record, made from the visitor's name and a three-to-four-word summary of the matter.
_Avoid_: matter summary, matter description

**Appointment Note**:
A booking-specific note added to a Smokeball matter after a non-urgent visitor books a session.
_Avoid_: matter field, appointment update

**Paid Intake**:
A visitor intake whose Legal Strategy Session payment has already been accepted.
_Avoid_: payment session, checkout record

**Smokeball Matter**:
The firm-side matter record created after a visitor becomes a paid intake.
_Avoid_: lead, unpaid inquiry, CRM record

**Matter Reference**:
The app-side reference used to connect a paid intake, payment, Smokeball matter, and document uploads.
_Avoid_: payment reference, Smokeball matter ID

**Invalid Intake**:
A visitor intake that lacks urgency or, for a session booking step, the visitor name or email needed to present booking.
_Avoid_: missing intake, bad route

**Missing Intake**:
The absence of a saved visitor intake for a session that is expected to have one.
_Avoid_: invalid intake, bad route

**Knowledge Gap**:
A visitor question that does not match any approved knowledge base entry.
_Avoid_: unanswered question, weak answer, low-confidence answer

**Knowledge Gap Report**:
A firm-facing monthly email listing knowledge gaps with minimal metadata for knowledge base enrichment.
_Avoid_: transcript report, unanswered report, chat review

**Knowledge Gap Category**:
A broad label that explains what kind of visitor demand a knowledge gap represents.
_Avoid_: legal topic classification, generated answer, practice-area commitment

**Current Coverage Gap**:
A knowledge gap in the chatbot's current approved coverage area that may warrant a new or revised approved answer.
_Avoid_: future practice-area request, weak answer

**Future Practice-Area Signal**:
A knowledge gap showing visitor demand for a practice area outside the chatbot's current approved coverage.
_Avoid_: current coverage gap, approved adjacent-practice answer

**Rule-Based Knowledge Gap Categorization**:
Assignment of a broad knowledge gap category from deterministic wording rules rather than model judgment.
_Avoid_: LLM classification, manual triage, legal taxonomy

**Visitor Information Question**:
A visitor message that asks for information rather than merely describing their situation.
_Avoid_: situation statement, intake detail, matter summary

**Sanitized Knowledge Gap Wording**:
The visitor's question wording after removing obvious contact details while preserving the legal meaning of the question.
_Avoid_: anonymized transcript, redacted matter history, generated summary

**Knowledgebase Enrichment Recipient**:
The firm recipient responsible for receiving knowledge gap reports.
_Avoid_: firm notification inbox, operational alert recipient

**Knowledgebase Enrichment**:
The human process of adding or revising approved knowledge base entries from knowledge gap reports.
_Avoid_: automatic answer generation, report status update

**Approved Knowledge Base**:
The firm-approved set of visitor-facing answers Banjo may relay.
_Avoid_: criminal law database, model memory, generated advice

**Adjacent Practice Demand Signal**:
A knowledge gap showing visitor interest in a non-criminal-law practice area the firm may cover in a future project.
_Avoid_: current practice-area support, substantive adjacent-practice advice

## Relationships

- A **Document Upload Resolution** may include zero or more uploaded files.
- An **In-Chat Document Upload** is one kind of **Document Upload Resolution**.
- An **In-Chat Document Upload** can complete for the visitor before automatic attachment to a **Smokeball Matter** is confirmed.
- A **Manual Attachment Fallback** may be needed when an **In-Chat Document Upload** cannot be confirmed as attached to a **Smokeball Matter**.
- A **Manual Attachment Fallback** should not be declared until the system has allowed a short window for the **Smokeball Matter** mapping to arrive.
- A firm notification for an **In-Chat Document Upload** should group the files from the same upload action together.
- A **Manual Attachment Fallback** gives the firm links to uploaded documents rather than binary email attachments.
- A **Manual Attachment Fallback** is not the durable document record; the intended durable record is the **Smokeball Matter**.
- A **Matter Summary** is descriptive content and is not the same as a **Matter Title**.
- A **Paid Intake** reaches exactly one **Post-Upload Booking Step** after a **Document Upload Resolution**.
- A **Post-Upload Booking Step** is either a **Session Booking Step** or an **Urgent Contact Step**.
- A **Session Booking Step** may include a **Matter Summary**, but does not require one.
- A **Paid Intake** may create a **Smokeball Matter**.
- A **Paid Intake** may create a **Smokeball Matter** whether its urgency is urgent or non-urgent.
- A **Matter Reference** connects the app's paid intake to the matching **Smokeball Matter** and later document uploads.
- An **Appointment Note** records only session booking details on the **Smokeball Matter** without repeating intake details or changing the **Matter Summary** or **Matter Title**.
- An **Invalid Intake** does not produce a Calendly booking step by default.
- A **Missing Intake** and an **Invalid Intake** are different failures even when the visitor-facing fallback is the same.
- A **Knowledge Gap** is recorded when a visitor asks a question and no **Approved Knowledge Base** entry matches it.
- A **Knowledge Gap Report** contains **Knowledge Gaps**, not full chat transcripts.
- Repeated **Knowledge Gaps** are merged only when their normalized question text is exactly the same.
- A **Knowledge Gap Report** uses the number of times a **Knowledge Gap** was asked as its primary metadata.
- A **Knowledge Gap** may have a **Knowledge Gap Category**.
- A **Knowledge Gap Category** may identify a **Current Coverage Gap** or a **Future Practice-Area Signal**.
- A **Knowledge Gap Category** is assigned through **Rule-Based Knowledge Gap Categorization**.
- A **Knowledge Gap Report** includes **Knowledge Gaps** from all visitors, whether or not they become paid intakes.
- A **Knowledge Gap Report** presents **Sanitized Knowledge Gap Wording**, not system-generated categories or suggested knowledgebase titles.
- When repeated **Knowledge Gaps** merge, the report shows one canonical exact visitor wording with the number of times it was asked.
- Capturing broader **Knowledge Gaps** does not change the visitor-facing fallback response.
- A **Visitor Information Question** is checked against the **Approved Knowledge Base** even when it is not a criminal-law question.
- The **Approved Knowledge Base** may contain criminal-law, firm-logistics, and adjacent-practice answers approved for visitors.
- An **Adjacent Practice Demand Signal** may appear in a **Knowledge Gap Report**, but broader practice-area chatbot coverage is a separate future project.
- A **Future Practice-Area Signal** is not automatically a commitment to expand the **Approved Knowledge Base**.
- A **Knowledge Gap Report** is sent to the **Knowledgebase Enrichment Recipient**, not the general operational notification inbox.
- A **Knowledge Gap Report** is sent even when there are zero **Knowledge Gaps** for the month.
- A **Knowledge Gap Report** covers the previous calendar month's **Knowledge Gaps**.
- A **Knowledge Gap** is resolved by adding or changing approved knowledge base coverage, not by updating a separate report status.
- A **Knowledge Gap Report** ranks **Knowledge Gaps** by times asked, highest first.
- A **Knowledge Gap Report** does not include client-identifying information.
- **Sanitized Knowledge Gap Wording** removes obvious contact details, but does not attempt to reliably remove every personal name.
- A **Knowledge Gap Report** is a plain email, not a CSV export or attachment.
- A **Knowledge Gap Report** is an input to **Knowledgebase Enrichment**, not a technical instruction manual.

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
> **Dev:** "Should the monthly knowledgebase email include weak matched answers?"
> **Domain expert:** "No — it includes only **Knowledge Gaps**, where no approved knowledge base entry matched the visitor's question."
> **Dev:** "Should a **Knowledge Gap Report** include the full visitor transcript?"
> **Domain expert:** "No — it should include the question text and lightweight metadata needed to enrich the knowledge base."
> **Dev:** "Should similar **Knowledge Gaps** be grouped together?"
> **Domain expert:** "Only exact normalized repeats are merged; legally different phrasing stays separate."
> **Dev:** "Do we need first-seen or last-seen dates in the **Knowledge Gap Report**?"
> **Domain expert:** "No — the useful signal is how many times each **Knowledge Gap** was asked."
> **Dev:** "Should paid-intake conversations be excluded from the **Knowledge Gap Report**?"
> **Domain expert:** "No — knowledgebase coverage is independent of whether the visitor later becomes a **Paid Intake**."
> **Dev:** "Should the system suggest knowledgebase titles for each **Knowledge Gap**?"
> **Domain expert:** "No — show **Sanitized Knowledge Gap Wording** only; the firm decides the approved wording."
> **Dev:** "Should every spelling or punctuation variant appear in the **Knowledge Gap Report**?"
> **Domain expert:** "No — merged repeats show one canonical exact visitor wording and the number of times it was asked."
> **Dev:** "Should the **Knowledge Gap Report** go to the same inbox as operational firm notifications?"
> **Domain expert:** "No — send it to the **Knowledgebase Enrichment Recipient**."
> **Dev:** "Should the monthly email be skipped if no **Knowledge Gaps** were captured?"
> **Domain expert:** "No — send a zero-gap **Knowledge Gap Report** so the firm knows the automation ran."
> **Dev:** "Should a **Knowledge Gap Report** remove gaps that the firm has already fixed?"
> **Domain expert:** "No — the report is sent after the month ends and covers the previous calendar month's captured gaps."
> **Dev:** "Do **Knowledge Gaps** need open, fixed, or ignored statuses?"
> **Domain expert:** "No — a **Knowledge Gap** is resolved when the approved knowledge base covers it."
> **Dev:** "Should a **Knowledge Gap Report** preserve capture order?"
> **Domain expert:** "No — rank **Knowledge Gaps** by how many times each was asked."
> **Dev:** "Should a **Knowledge Gap Report** include client names, emails, phone numbers, payment references, or session IDs?"
> **Domain expert:** "No — it contains no client-identifying information."
> **Dev:** "If the visitor types identifying details inside a question, should the system rewrite the whole question?"
> **Domain expert:** "No — use **Sanitized Knowledge Gap Wording** by removing obvious contact details while preserving legal meaning."
> **Dev:** "Should a **Knowledge Gap Report** include a CSV attachment?"
> **Domain expert:** "No — the report is a plain email."
> **Dev:** "Should a **Knowledge Gap Report** explain how to edit the repository?"
> **Domain expert:** "No — it should frame the questions for **Knowledgebase Enrichment**; the actual knowledgebase update is handled separately."
> **Dev:** "Should questions outside criminal law be excluded from **Knowledge Gap Reports**?"
> **Domain expert:** "No — include them because they can signal visitor demand for broader knowledge base coverage."
> **Dev:** "Should non-criminal-law gaps appear in the same list without context?"
> **Domain expert:** "No — use a broad **Knowledge Gap Category** so the demand signal is clear."
> **Dev:** "Should the model decide each **Knowledge Gap Category** during chat?"
> **Domain expert:** "No — use **Rule-Based Knowledge Gap Categorization**."
> **Dev:** "Should capturing non-criminal-law **Knowledge Gaps** change what the visitor sees?"
> **Domain expert:** "No — it changes reporting only, not the visitor-facing fallback response."
> **Dev:** "Should only criminal-law questions be checked for **Knowledge Gaps**?"
> **Domain expert:** "No — any **Visitor Information Question** should be checked, but situation statements should not."
> **Dev:** "Is the knowledge base only for criminal-law Q&A?"
> **Domain expert:** "No — the **Approved Knowledge Base** is the set of firm-approved answers Banjo may relay to visitors."
> **Dev:** "Should adjacent-practice questions turn Banjo into a broader legal assistant now?"
> **Domain expert:** "No — treat them as **Adjacent Practice Demand Signals** unless the firm separately approves broader practice-area coverage."
> **Dev:** "Should all **Knowledge Gaps** imply immediate knowledgebase work?"
> **Domain expert:** "No — distinguish **Current Coverage Gaps** from **Future Practice-Area Signals**."

## Flagged ambiguities

- "booking flow module" could mean either a domain decision module or a chat-message builder — resolved: it decides the **Post-Upload Booking Step**, while a chat adapter handles chat representation.
- "unanswered question" could mean no bot reply, a weak answer, or no knowledge base match — resolved: use **Knowledge Gap** for no knowledge base match only.
- "monthly email" could mean a chat review digest or a knowledgebase enrichment queue — resolved: use **Knowledge Gap Report** for the enrichment email.
