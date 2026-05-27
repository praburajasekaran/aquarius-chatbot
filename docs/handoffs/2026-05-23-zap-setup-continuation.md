# Handoff: Finish and Test Remaining Zap Setups

## Focus

Continue manual Zapier setup/testing for Aquarius chatbot Smokeball automation.

The next session should focus on Zapier configuration and verification, not broad code changes. Code for the current Zap flows is already present locally but has not all been committed; only change code if a Zap test exposes a concrete app bug.

## Current Repo State

- Repo: `/Users/praburajasekaran/local-sites/aquarius-chatbot`
- Branch: `main`
- Latest pushed report commit before this handoff: `0433d2b Add knowledge gap report`
- Worktree still has unrelated/uncommitted Smokeball/Zapier implementation files. Do not revert them.
- Existing detailed Zap handoff: `docs/handoffs/2026-05-22-zapier-smokeball-config.md`
- Current integration status/runbook: `docs/2026-04-23-integration-status.md`
- Implementation plan: `docs/plans/2026-05-22-smokeball-zapier-paid-intake-plan.md`
- ADR: `docs/adr/0002-confirm-smokeball-matter-creation-via-tail-callback.md`

## What Appears Done

Zap #1, paid intake to Smokeball matter creation, appears to have the clearest setup path and prior notes:

- Trigger: Webhooks by Zapier Catch Hook, prod hook ending `ujx0819`
- Filter: continue only if top-level `isTest` is false or absent
- Action: Smokeball Create Matter
- Tail callback: Webhooks by Zapier POST to `/api/webhooks/smokeball-matter-created`
- Header: `X-Smokeball-Capture-Secret: <SMOKEBALL_CAPTURE_SECRET>`
- Body: `{ sessionId, smokeballMatterId }`

Detailed mapping and testing caveats are already captured in `docs/handoffs/2026-05-22-zapier-smokeball-config.md`; use that file rather than reconstructing from memory.

## Two Likely Remaining Zaps

The user's current belief is that two Zaps still need configuration and testing. Based on the current docs/code, those are probably:

1. Zap #2: Smokeball file attachment Zap
   - Env var: `ZAPIER_ATTACH_WEBHOOK_URL`
   - Used by in-chat uploads and late uploads.
   - Current helper: `src/lib/in-chat-upload/deliver-to-zapier.ts`
   - Existing late-upload implementation: `src/lib/late-upload/handle-completed.ts`
   - Payload includes `matter_ref`, `smokeball_matter_id`, `session_id`, `client_email`, `client_name`, `file`, `uploaded_at`, and `source`.
   - It requires the session-to-Smokeball matter mapping captured by Zap #1's tail callback.
   - If mapping or Zap delivery fails, the app sends a firm email with Blob links for manual attachment.

2. Zap #4: Calendly appointment-note Zap
   - Env var: `ZAPIER_APPOINTMENT_NOTE_WEBHOOK_URL`
   - Current helper: `src/lib/smokeball/appointment-note.ts`
   - Trigger: Webhooks by Zapier Catch Hook
   - Recommended filter: same top-level `isTest` production guard
   - Action: Smokeball Add Note to Matter
   - Payload includes `smokeball_matter_id`, `matter_ref`, `session_id`, `client_name`, `client_email`, appointment start times, Calendly URIs, optional `payment_ref`, and `note`.
   - Calendly webhook passes `utm_content` as the session tracking value. If tracking is missing, app sends a manual-follow-up alert.

Zap #3, audit log, may also be unfinished depending on current Zapier state:

- Env var: `ZAPIER_AUDIT_WEBHOOK_URL`
- Docs say action was deferred: Google Sheet append or email.
- In-chat upload code can post audit rows if the env var is set.
- Confirm with the user whether this is one of the "2 zaps" they meant, or whether they mean attach + appointment-note.


## Zap Step Configuration

### Zap #1: Paid Intake -> Smokeball Create Matter -> Tail Callback

This one may already be configured, but verify it before testing the dependent Zaps.

Step 1: Webhooks by Zapier - Catch Hook

- Hook URL goes in production as `ZAPIER_WEBHOOK_URL`.
- Known prod hook suffix from earlier setup: `ujx0819`.
- Expected payload source: `src/lib/smokeball/create-matter.ts`.
- Required sample fields: `event`, `matter_ref`, `session_id`, `payment_ref`, `payment_amount_cents`, `client_name`, `client_email`, `client_phone`, `urgency`, `matter_summary`, `matter_title`, `display_price`, `paid_at`, `source`, `isTest`.

Step 2: Filter by Zapier

- Continue only if `isTest` exactly matches `false` OR `isTest` does not exist.
- Do not bind a nested key for the safety flag. Use the top-level `isTest` field.
- A sample with `isTest: true` should show that it would not have continued.

Step 3: Smokeball - Create Matter

- State: `NSW`
- Matter Type: `Criminal General - NSW` or the current confirmed Smokeball criminal general matter type.
- Use Existing Client: `False`
- Contact Type: `Person`
- Title / Matter Title: `matter_title`
- First Name / Last Name: use Zapier Formatter output if configured, otherwise map from the webhook sample's parsed name fields if available.
- Mobile Phone Number: `client_phone`
- Email: `client_email`
- Description:

```text
Matter Ref: {{matter_ref}}
Payment Ref: {{payment_ref}}
Urgency: {{urgency}}

Matter Summary:
{{matter_summary}}
```

- Notes: `matter_summary`, or the same combined block if Description is not prominent enough in Smokeball.

Step 4: Optional Storage by Zapier - Set Multiple Values

- This is not the app's source of truth.
- If kept, store `session_id` -> Smokeball matter ID for Zapier-side debugging only.
- Do not depend on this instead of Step 5.

Step 5: Webhooks by Zapier - POST

- URL: `https://YOUR_APP_DOMAIN/api/webhooks/smokeball-matter-created`
- Local/ngrok URL: `https://YOUR_NGROK_DOMAIN/api/webhooks/smokeball-matter-created`
- Headers: `Content-Type: application/json` and `X-Smokeball-Capture-Secret: <SMOKEBALL_CAPTURE_SECRET>`
- JSON body:

```json
{
  "sessionId": "{{session_id from Step 1}}",
  "smokeballMatterId": "{{Matter ID from Step 3}}"
}
```

- `smokeballMatterId` must be the real Smokeball matter ID output by Step 3, not `matter_ref` or `session_id`.

### Zap #2: Upload File to Existing Smokeball Matter

Step 1: Webhooks by Zapier - Catch Hook

- Hook URL goes in `ZAPIER_ATTACH_WEBHOOK_URL`.
- Existing status doc references prod hook suffix `e2kcqq`.
- Expected payload sources: `src/lib/in-chat-upload/deliver-to-zapier.ts` and `src/lib/late-upload/handle-completed.ts`.
- Expected payload fields: `matter_ref`, `smokeball_matter_id`, `session_id`, `client_email`, `client_name`, `file.url`, `file.name`, `file.content_type`, `file.size_bytes`, `uploaded_at`, `source`.

Step 2: Filter by Zapier

- If the payload includes `isTest`, use the same filter as Zap #1: continue only if `isTest` is false or absent.
- If there is no `isTest` in this payload, configure testing around URL/environment separation and use obvious test file names.
- Also consider a guard that `smokeball_matter_id` exists.

Step 3: Smokeball - Upload File / Attach File to Matter

- Matter ID / Matter: `smokeball_matter_id`
- File URL / File: `file.url`
- File Name: `file.name`
- Content Type / MIME Type if available: `file.content_type`
- Notes/Description if available:

```text
Matter Ref: {{matter_ref}}
Uploaded via Aquarius chatbot.
Source: {{source}}
Uploaded at: {{uploaded_at}}
```

Step 4: Test Result

- Confirm the file appears on the Smokeball matter created by Zap #1.
- Confirm the app still sends the firm upload notification email. That email is the manual fallback and should include Blob links whether Zap delivery succeeds or fails.

### Zap #3: Upload Audit Log

Only configure this if it is one of the remaining two Zaps.

Step 1: Webhooks by Zapier - Catch Hook

- Hook URL goes in `ZAPIER_AUDIT_WEBHOOK_URL`.
- Existing status doc references hook suffix `ujp4wvd`.
- Expected in-chat upload audit payload fields: `event`, `matter_ref`, `smokeball_matter_id`, `session_id`, `client_email`, `client_name`, `file_name`, `file_size_bytes`, `attach_zap_status`, `firm_status`, `uploaded_at`.

Step 2: Action

- Preferred action: Google Sheets - Create Spreadsheet Row.
- Fallback action: Email by Zapier if the audit sheet is not ready.
- Suggested columns: Timestamp, Event, Matter Ref, Smokeball Matter ID, Client Name, Client Email, File Name, File Size Bytes, Attach Zap Status, Firm Status.

Step 3: Test Result

- Confirm one row/email per uploaded file.
- Confirm failed attach attempts still produce an audit row with `attach_zap_status: failed`.

### Zap #4: Calendly Booking -> Smokeball Appointment Note

Step 1: Webhooks by Zapier - Catch Hook

- Hook URL goes in `ZAPIER_APPOINTMENT_NOTE_WEBHOOK_URL`.
- Expected payload source: `src/lib/smokeball/appointment-note.ts`.
- Expected payload fields: `event`, `matter_ref`, `session_id`, `smokeball_matter_id`, `smokeball_note_target`, `client_name`, `client_email`, `appointment_start_time`, `appointment_start_time_local`, `appointment_time_zone`, `calendly_event_uri`, `calendly_invitee_uri`, `payment_ref`, `matter_note_title`, `matter_note_body`, `note`, `source`, `isTest`.

Step 2: Filter by Zapier

- Continue only if `isTest` exactly matches `false` OR `isTest` does not exist.
- Optional additional guard: `smokeball_matter_id` exists.

Step 3: Smokeball - Add Note to Matter

- Matter ID / Matter: `smokeball_matter_id`
- Note Title / Subject: `matter_note_title`
- Note Body: `matter_note_body`
- If Zapier only exposes one free-text note field, use `matter_note_body`.
- `note` is a backward-compatible alias for `matter_note_body`; prefer the explicit matter-note fields for new Zap mappings.
- Do not map these fields to contact Notes, matter summary, or matter title. The booking belongs in the Smokeball matter's notes/memos area.

Step 4: Test Result

- Confirm a note appears on the correct Smokeball matter.
- Confirm the note is booking-only and does not duplicate full intake details or transcript content.
- If no session mapping exists, the app should not call this Zap; it should alert the firm for manual follow-up instead.

## Test Plan For Next Session

1. Confirm which two Zaps remain in Zapier UI.
2. Verify env vars locally and in Vercel Production/Preview:
   - `ZAPIER_WEBHOOK_URL`
   - `ZAPIER_ATTACH_WEBHOOK_URL`
   - `ZAPIER_AUDIT_WEBHOOK_URL` if audit is in scope
   - `ZAPIER_APPOINTMENT_NOTE_WEBHOOK_URL`
   - `SMOKEBALL_CAPTURE_SECRET`
3. Use `isTest: true` for Zap-level setup samples where possible.
4. Be careful: testing a Smokeball action step directly in Zapier may bypass the filter and create a real Smokeball record. If direct testing is required, use unmistakable `LIVE TEST DELETE ME` naming and delete/archive the Smokeball record after verification.
5. After Zap #1 creates a test matter and tail callback stores the mapping, test the attach Zap using a real mapped `sessionId`/`smokeballMatterId` pair.
6. Test appointment-note Zap only after the session mapping exists, otherwise the app will correctly send a manual-follow-up alert instead of posting to Zapier.
7. Watch app logs for these structured events:
   - `appointment_note_zap_delivered`
   - `appointment_note_mapping_missing`
   - `appointment_note_webhook_missing`
   - `appointment_note_zap_failed`
   - `in_chat_zapier_delivered`
   - `in_chat_attach_zap_failed`
   - `in_chat_no_matter_mapping`
   - `in_chat_audit_zap_failed`

## Useful Focused Tests

Run these if changing or validating local implementation:

```sh
npm run test -- tests/handle-paid-smokeball.test.ts tests/smokeball-create-matter.test.ts tests/smokeball-appointment-note.test.ts tests/calendly-webhook-smokeball.test.ts tests/in-chat-upload-delivery.test.ts
```

Known from earlier sessions: full repo lint/typecheck may fail because of unrelated pre-existing issues. Prefer focused checks unless the user explicitly asks for a full cleanup.

## Files Most Likely Relevant

- `.env.example`
- `docs/2026-04-23-integration-status.md`
- `docs/handoffs/2026-05-22-zapier-smokeball-config.md`
- `docs/plans/2026-05-22-smokeball-zapier-paid-intake-plan.md`
- `docs/adr/0002-confirm-smokeball-matter-creation-via-tail-callback.md`
- `src/lib/smokeball/create-matter.ts`
- `src/lib/smokeball/appointment-note.ts`
- `src/lib/in-chat-upload/deliver-to-zapier.ts`
- `src/lib/late-upload/handle-completed.ts`
- `src/app/api/webhooks/smokeball-matter-created/route.ts`
- `src/app/api/webhooks/calendly/route.ts`
- `src/lib/session-matter-map.ts`

## Suggested Skills Next Session

- `diagnose` if a Zap test produces unexpected app logs, missing callback state, or failed delivery.
- `chrome` if continuing setup inside the authenticated Zapier UI.
- `browser:browser` if testing local/localhost app flows.
- `handoff` if pausing again after partial Zap setup.
