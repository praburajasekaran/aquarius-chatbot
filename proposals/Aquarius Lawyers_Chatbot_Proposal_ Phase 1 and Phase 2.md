  
**PROJECT PROPOSAL**

AI Legal Chatbot

Prepared for: Aquarius Lawyers

Prepared by: Saravanan | saravanan@motionify.co

Date: 10 April 2026 | Confidential

**Phase 1 Total: $3,000 AUD • Phase 2 Total: $9,000 AUD**

# **1\. Executive Summary**

Aquarius Lawyers needs an intelligent chatbot on its Criminal Law page to engage visitors and convert them into clients. The chatbot will answer firm-approved questions (text and voice input), collect client details, process legal strategy service (LSS) fees via Stripe, accept document uploads, book appointments through Calendly, and automatically create leads, contacts, matters, and attach documents in Smokeball via Zapier. A complete conversation transcript is emailed to the firm for every enquiry.

**Phase 1 scope:** Criminal Law Module | **Price: $3,000 AUD** (all-inclusive) | **Timeline: 15 business days**

*This document constitutes the final agreed scope. No deviation shall occur without written consent from both parties. Any change requests outside this scope will be quoted separately.*

# **2\. Service Tiers**

The chatbot handles two service tiers for criminal law matters:

| Service Tier | Fee (excl. GST) | Fee (incl. GST) | Routing |
| :---- | :---- | :---- | :---- |
| Urgent Criminal Matter | $1,200 | $1,320 | Payment → Document Upload → Call firm during office hours |
| Non-Urgent Criminal Matter | $660 | $726 | Payment → Document Upload → Calendly Appointment Booking |

# **3\. Chatbot Workflow**

![][image1]

[View full size](https://www.tldraw.com/f/sHQnLlphJynrzjtFtN3Qk?d=v-562.-1069.9766.4909.p2oZwDf_n8C2BeTRwjgOM)

The end-to-end visitor journey follows these steps:

### **Visitor Journey**

* **Step 1 – Arrival:** Chatbot widget appears on the Criminal Law page 24/7 with a welcome message.

* **Step 2 – Q\&A:** Visitor asks a question via text or voice. The chatbot matches it against the firm-approved knowledge base. If there is no match, a fallback response directs them to contact the firm. No answers are generated outside the approved Q\&A list.

* **Step 3 – Collect Details:** Full name, email (validated), phone (Australian format), matter type/description — all required.

* **Step 4 – Urgency:** Visitor selects urgent or non-urgent. Wording provided by Aquarius Lawyers.

* **Step 5A – Urgent Path:** LSS fee $1,320 (incl. GST) via Stripe → document upload (encrypted storage) → prompt to call a firm during office hours.

* **Step 5B – Non-Urgent Path:** LSS fee $726 (incl. GST) via Stripe → document upload (encrypted storage) → Calendly booking widget.

* **Step 6 – Back-End Processing:** Email with full transcript, details, payment confirmation, and documents sent to info@aquariuslawyers.com.au. Zapier creates Lead, Contact, Matter in Smokeball with documents attached.

* **Step 7 – Confirmation:** Visitor sees summary: matter reference, payment receipt, uploaded documents, and appointment time (if non-urgent).

# 

# **4\. Compliance & Security**

### **Data Protection**

* All data encrypted in transit (TLS 1.2+) and at rest (AES-256).

* Payment via Stripe (PCI DSS Level 1\) — no card data touches our servers.

* Personal info and uploaded documents transmitted directly to Smokeball via Zapier and attached to the firm notification email. No files are stored in any intermediate database or cloud bucket.

* Chat data deleted at end of session.

### **Legal Compliance**

* Chatbot delivers ONLY firm-approved, pre-written Q\&A responses — no generative AI for answers.

* Clear disclaimer visible at all times: responses are general information, not legal advice.

* Cost disclosure displayed before any payment, per Legal Profession Uniform Law.

### **Australian Privacy Principles (APPs)**

| Principle | Implementation |
| :---- | :---- |
| APP 1 – Transparency | Privacy policy linked in widget |
| APP 3 – Data minimisation | Only booking-essential data collected |
| APP 5 – Notification | Pre-chat disclaimer; privacy link visible |
| APP 6 – Use/disclosure | Data used solely for stated purpose |
| APP 8 – Cross-border | US-based services disclosed (see Data Flow table) |
| APP 11 – Security | HTTPS/TLS; encrypted storage; firm-only file access |

### **Voice Input & Document Upload**

* Voice: Browser-native Web Speech API (Chrome, Edge, Safari). Audio is NOT recorded or stored — converted to text in real time within the visitor’s browser. Fallback to text-only on unsupported browsers.

* Documents: PDF, JPG, PNG, DOCX accepted (max 10 MB). Files scanned for malware, then transmitted directly to Smokeball via Zapier and attached to the firm notification email. No files are retained after processing.

# **5\. Content Required from Aquarius Lawyers**

### **5.1 Approved Q\&A Knowledge Base**

Minimum 15 question-and-answer pairs for common criminal law enquiries. These are the ONLY responses the chatbot will deliver. Sample Q\&As have been provided separately for your review and approval.

### **5.2 Chat Guidelines**

Welcome message, fallback message, urgency question wording, disclaimer text, cost disclosure text, business hours definition, thank-you/confirmation text, and brand tone preferences.

### **5.3 Document Types**

* **Urgent:** Charge sheet, court attendance notice, bail conditions, police facts, other court documents.

* **Non-Urgent:** Charge sheet (if applicable), court notice (if applicable), relevant correspondence.

### **5.4 Access & Credentials**

WordPress admin access, Stripe account/API keys (or guided setup), Calendly scheduling link (configured), Smokeball access via Zapier and Resend API key (10-min guided auth session).  

# **6\. Technical Architecture**

| Integration | Purpose | Method |
| :---- | :---- | :---- |
| Stripe | LSS fee processing | Embedded Stripe Checkout |
| Calendly | Appointment booking (non-urgent) | Embedded widget |
| Smokeball | Lead/contact/matter creation \+ doc attachment | Zapier automation |
| WordPress | Chatbot deployment | JavaScript widget embed |
| Email (Resend) | New matter notifications \+ transcript | Automated email |

The chatbot is embedded as a JavaScript widget, hosted on a secure cloud platform. All communications via HTTPS. The chatbot responds ONLY from the approved knowledge base. LLM is used for intent matching against approved Q\&A only, not for generating novel answers. 

### **Tentative Third-Party Service Costs (Paid by Aquarius Lawyers)**

The following third-party services are required for the chatbot to function. These are ongoing costs payable directly by Aquarius Lawyers and are separate from the development fee.

| Service | Plan Required | Est. Cost (AUD/mo) | Notes |
| :---- | :---- | :---- | :---- |
| Zapier | Professional (minimum) | \~$86.52/mo | Multi-step Zaps required for Smokeball integration. Free plan (100 tasks, 2-step only) is insufficient. |
| Stripe | Standard | No monthly fee | 2.9% \+ $0.30 per transaction. Deducted from each LSS payment. |
| Calendly | Standard or higher | \~$15-$20/mo | Required for embedded booking widget. The free plan may suffice if features are adequate. |
| Smokeball | Existing subscription | As per current plan | No additional cost if already subscribed. |
| Vercel | Pro | \~$31/mo | Hosting, serverless functions, file storage. Hobby plan not permitted for commercial use. |
| Resend | Free  | $0 | Email notifications and transcripts. Free tier covers 3,000 emails/month. |

*Note: Zapier pricing is based on published rates as at April 2026 and may vary with exchange rates. The Professional plan supports unlimited premium app connections and multi-step Zaps needed for the Smokeball workflow. If enquiry volumes grow beyond 2,000 tasks/month, the Team plan (\~$153.07 AUD/mo) may be required. We will advise on the most cost-effective plan during setup.*

# **7\. Responsibilities**

### **Aquarius Lawyers (Client)**

* Provide all content (Q\&A, chat guidelines, document types) and access credentials before Milestone 1 kickoff.

* Participate in Smokeball/Zapier auth session (\~5 min, around Day 10–12).

* Participate in a joint acceptance test (Day 15\) and provide written sign-off at each milestone.

* Designate a single point of contact; respond to queries within 2 business days.

### **Developer (Our Team)**

* Design, develop, and deploy the chatbot with all integrations (Stripe, Calendly, voice input, document upload, Smokeball via Zapier, email notifications) per this specification.

* Conduct end-to-end testing (Days 13–14) and joint acceptance test (Day 15).

* Deploy to live Criminal Law page upon written client approval.

* Provide 14 days of post-launch bug-fix support (defects only).

# **8\. Timeline & Milestones**

### **15 Business Day Build Schedule**

| Day | Activity |
| :---- | :---- |
| Day 0 | Milestone 1 paid, all credentials received, work begins |
| Days 1–10 | Build chatbot \+ all integrations (Stripe, Calendly, file upload, email) |
| Days 11–12 | Zapier/Smokeball \+ Resend setup session with client (\~15 mins) |
| Days 13–14 | End-to-end testing, fix any issues |
| Day 15 | Joint acceptance test → Milestone 2 paid → Go live |

### **Milestone 1: Kickoff — $1,800 AUD**

**Payment trigger:** Receipt of signed agreement \+ all content and credentials listed in Section 5\. Work begins within 48 hours. 

### **Milestone 2: Full Working System — $1,200 AUD**

**Payment trigger:** Written sign-off after joint acceptance test. The test walks through 5 complete user journeys (question → answer → payment → booking → upload → Smokeball). All data must appear correctly in Smokeball within 5 minutes, email notifications received, and no critical errors.

# **9\. Payment Summary**

| Milestone | Description | Amount (AUD) | Trigger |
| :---- | :---- | :---- | :---- |
| M1 | Kickoff — agreement \+ content \+ access | $1,800 | Receipt of all kickoff items |
| M2 | Full working system — live deployment \+ acceptance test | $1,200 | Written sign-off after joint test |

All amounts in AUD. GST applied as applicable. Invoices issued at each milestone; payment due within 7 days.

# **10\. Post-Launch Support**

### **Included (14 Days Post Go-Live)**

Bug fixes for specified functionality, up to 5 minor Q\&A text corrections, Zapier/Smokeball sync monitoring, and one round of minor styling adjustments.

### **Ongoing Maintenance**

| Plan | Coverage | Monthly Fee (AUD) |
| :---- | :---- | :---- |
| Single Practice Area | Criminal Law chatbot only | $400/month |
| All Five Practice Areas | Criminal, Seafood & Marine, Property, Wills & Estates, Commercial | $600/month |

Includes: uptime monitoring, Zapier/Smokeball checks, up to 5 Q\&A updates/month, bug fixes, and compatibility updates. New features, bulk Q\&A additions, payment tier changes, and new integrations quoted separately.

# **11\. Intellectual Property**

* **Client-owned:** All Q\&A content, chat guidelines, legal disclaimers, brand materials, and all client data collected through the chatbot.

* **Developer-owned:** Underlying chatbot framework, codebase architecture, reusable components, libraries, and development tools. Developers retain the right to reuse in other projects.

* **Licence to client:** Upon full payment ($3,000 AUD), a perpetual, non-exclusive, royalty-free licence to use, modify, and operate the delivered chatbot. Does not include rights to resell or sublicence the framework.

* **Third-party services:** Stripe, Calendly, Smokeball, Zapier, and WordPress are subject to their own terms. Aquarius Lawyers is responsible for maintaining active subscriptions.

* **Confidentiality:** Both parties treat all project communications, credentials, and business information as confidential. Obligations survive termination.

# **12\. Change Management, Liability & Termination**

* **Changes:** Any scope changes must be submitted in writing, quoted within 3 business days, and approved by both parties before implementation.

* **Liability:** Developer’s total liability shall not exceed $3,000 AUD. The developer is not liable for third-party service downtime. Aquarius Lawyers is solely responsible for legal accuracy of all Q\&A content, disclaimers, and cost disclosures.

* **Termination:** Either party may terminate with 14 days’ written notice. Completed milestones and work in progress (pro-rated) will be invoiced. Client content and data returned or destroyed as directed.

# **13\. Phase 2: Remaining Four Practice Areas**

Upon successful Phase 1 completion, the chatbot can be expanded to Seafood & Marine Law, Property Law, Wills & Estates, and Commercial Law. 

**Phase 2 Fee:** $9,000 AUD

**Total Project Fee (Phase 1 \+ Phase 2):** $12,000 AUD

# **14\. Data Flow Reference**

| Service | Role | Location | Retention |
| :---- | :---- | :---- | :---- |
| Vercel | Hosting, database, file storage | US (AWS/GCP) | Session \+ 30 days logs |
| Claude/GPT API | Q\&A intent matching against firm-approved responses only — no novel content  | US | Zero-retention; no training |
| Zapier | Automation to Smokeball | US | Transient pass-through only |
| Smokeball | Practice management (final store) | Australia | Per Smokeball policy |
| Stripe | Payment processing (PCI-DSS L1) | US/AU | Per Stripe policy (7yr tax) |
| Calendly | Appointment scheduling | US | Per Calendly policy |
| Resend | Email delivery | US | Delivery logs only |

# **15\. Phase 2: Remaining Four Practice Areas — $9,000 AUD**

Upon successful completion of Phase 1 (Criminal Law Module), Aquarius Lawyers may engage the developer to expand the chatbot system to the remaining four practice areas:

* Seafood & Marine Law  
* Property Law  
* Wills & Estates  
* Commercial Law

## **Phase 2 includes:**

* Individual chatbot modules for each of the four practice areas  
* Unified knowledge base across all five areas  
* Full compliance documentation and handover

### **Phase 2 Delivery Timeline (6 Weeks / 30 Business Days):**

| Week | What Happens |
| ----- | ----- |
| Week 0 | Phase 2 paid, Q\&A content for all four areas received, work begins |
| Weeks 1–3 | Build and configure all four practice area chatbots, set up individual Q\&A knowledge bases, deploy widgets to each WordPress page |
| Weeks 4–5 | End-to-end testing per area — Smokeball matters created correctly, Calendly triggers, payments route properly, transcripts emailed |
| Week 6 | Joint acceptance testing with client across all five areas (including Criminal Law regression), final sign-off, compliance documentation and handover |

**Phase 2 Fee:** $9,000 AUD  
**Total Project Fee (Phase 1 \+ Phase 2):** $12,000 AUD

This phased approach de-risks the engagement for both parties. You verify the system works exactly as specified in Phase 1 before committing to the full rollout. The reusable framework built in Phase 1 will significantly reduce development time for subsequent modules.

# 

# **16\. Acceptance**

By signing below, both parties confirm they have read, understood, and agree to the terms, scope, responsibilities, milestones, and intellectual property provisions set out in this proposal. This document constitutes the binding agreement for Phase 1\.

| For Aquarius Lawyers Authorised Signatory Name Signature Date |  | For Motionify Name: [Saravanan M](mailto:saravanan@motionify.co)Motionify Signature Date |
| :---- | :---- | :---- |

[image1]: <data:image/png;base64,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>