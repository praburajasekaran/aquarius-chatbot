# Handoff: Continue Zapier/Smokeball Configuration

## Focus

Continue manual Zapier setup for the Aquarius chatbot Smokeball integration.

The code implementation is already done in `/Users/praburajasekaran/local-sites/aquarius-chatbot`; do not re-implement unless a Zap configuration issue reveals a code bug.

## Relevant Existing Artifacts

- Implementation plan: `/Users/praburajasekaran/local-sites/aquarius-chatbot/docs/plans/2026-05-22-smokeball-zapier-paid-intake-plan.md`
- ADR: `/Users/praburajasekaran/local-sites/aquarius-chatbot/docs/adr/0002-confirm-smokeball-matter-creation-via-tail-callback.md`
- Env documentation: `/Users/praburajasekaran/local-sites/aquarius-chatbot/.env.example`
- Zap setup notes: `/Users/praburajasekaran/local-sites/aquarius-chatbot/docs/2026-04-23-integration-status.md`
- Create-matter payload builder: `/Users/praburajasekaran/local-sites/aquarius-chatbot/src/lib/smokeball/create-matter.ts`
- Appointment-note payload/delivery: `/Users/praburajasekaran/local-sites/aquarius-chatbot/src/lib/smokeball/appointment-note.ts`
- Tail callback route: `/Users/praburajasekaran/local-sites/aquarius-chatbot/src/app/api/webhooks/smokeball-matter-created/route.ts`

## Current Zapier State

User is configuring existing Zap #1 named `#1 Aquarius — Intake + Payment (main)`.

Current Zap #1 shape:

1. Webhooks by Zapier: Catch Hook
2. Filter by Zapier: filter conditions
3. Smokeball: Create Matter
4. Storage by Zapier: Set Multiple Values
5. Webhooks by Zapier: POST

Zap #1 hook URL used for a sample push is stored outside git as `ZAPIER_WEBHOOK_URL`.
Do not commit the full Zapier hook URL; it is effectively a credential.

A safe sample payload was already sent successfully with `isTest: true` so production Smokeball should not create a matter through the live filter path:

```json
{
  "event": "paid_intake.create_matter",
  "matter_ref": "TEST-session-matter-title-20260522",
  "session_id": "TEST-session-matter-title-20260522",
  "payment_ref": "TEST-BPOINT-123",
  "payment_amount_cents": 132000,
  "client_name": "Filter SampleV5",
  "client_email": "filter-sample-v5@test.invalid",
  "client_phone": "+61410000001",
  "urgency": "non-urgent",
  "matter_summary": "Testing matter title mapping for Smokeball Zap configuration",
  "matter_title": "Filter SampleV5 - Testing matter title mapping",
  "display_price": "$1,320",
  "paid_at": "2026-05-22T18:30:00.000Z",
  "source": "chatbot/paid-intake",
  "isTest": true
}
```

Zapier accepted it with request ID:

`019e4fe9-d150-a358-5f48-70e8e3303b4c`

## Decisions/Guidance Already Given

- Zap #1 Step 2 filter is correct:
  - continue if `isTest` does not exist OR `isTest` exactly matches `false`
  - the sample with `isTest: true` should show "would not have continued"
- Smokeball Create Matter does not expose a dedicated Matter Reference field. That is not a blocker.
- Put the app Matter Reference somewhere Smokeball exposes, preferably Description or Notes.
- Step 5 tail callback is the critical app confirmation, not Zapier Storage.
- `SMOKEBALL_CAPTURE_SECRET` is a shared secret generated with:

```bash
openssl rand -base64 32
```

Set the same value in the app env and in Zapier Step 5 header:

`X-Smokeball-Capture-Secret: <value>`

Do not commit the real value.

## Suggested Step #3 Create Matter Mapping

Use fields exposed by the Smokeball Create Matter step:

- State: `NSW`
- Matter Type: `Criminal General - NSW`
- Use Existing Client: `False`
- Contact Type: `Person`
- Title: `matter_title`
- First Name / Last Name: use Zapier Formatter output if available, otherwise current parsed values from the webhook sample are acceptable
- Mobile Phone Number: `client_phone`
- Email: `client_email`
- Description: use a combined block:

```text
Matter Ref: {{matter_ref}}
Payment Ref: {{payment_ref}}
Urgency: {{urgency}}

Matter Summary:
{{matter_summary}}
```

- Notes: either `matter_summary` only, or the same combined block if Description is not visible enough in Smokeball.

## Testing Caveat

Zapier may not offer "Skip test" for Smokeball Step 3. Testing Step 3 directly may create a real Smokeball matter even if Step 2 blocks `isTest: true`, because Zapier action tests often run the selected action directly.

If Zapier requires a Step 3 test, make the sample unmistakably disposable:

- Title: `LIVE TEST DELETE ME - Zapier mapping`
- First Name: `LIVE TEST`
- Last Name: `DELETE ME`
- Email: `zapier-test@example.invalid`
- Mobile: `+61410000001`
- Description/Notes should begin with `TEST MATTER - DELETE ME`

Then delete/archive the Smokeball matter after testing.

## Step #5 Tail Callback Configuration

Configure Webhooks by Zapier POST:

URL:

`https://YOUR_APP_DOMAIN/api/webhooks/smokeball-matter-created`

For local/ngrok testing:

`https://YOUR_NGROK_DOMAIN/api/webhooks/smokeball-matter-created`

Headers:

```text
Content-Type: application/json
X-Smokeball-Capture-Secret: <SMOKEBALL_CAPTURE_SECRET>
```

JSON body:

```json
{
  "sessionId": "{{session_id from Step 1}}",
  "smokeballMatterId": "{{Matter ID from Step 3}}"
}
```

Make sure `smokeballMatterId` is the real Smokeball matter ID output from Step 3, not `matter_ref` / `session_id`.

## Remaining Zap Work

1. Finish/verify Zap #1 Step 3 Create Matter mappings.
2. Configure Zap #1 Step 5 tail POST callback with `SMOKEBALL_CAPTURE_SECRET`.
3. Create a separate appointment-note Zap:
   - Catch Hook URL goes into `ZAPIER_APPOINTMENT_NOTE_WEBHOOK_URL`
   - same `isTest` filter
   - Smokeball Add Note to Matter using `smokeball_matter_id`
   - map the note title/subject to `matter_note_title`
   - map the note body/content to `matter_note_body` so the booking details land in matter notes/memos, not contact Notes or the matter summary
4. Run a production-shaped smoke test only when ready to create/delete a real Smokeball test matter.

## Suggested Skills

- `handoff` only if pausing again.
- `diagnose` only if a Zap test produces unexpected app logs or callback failures.
- `browser` or `chrome` if continuing inside Zapier UI and browser automation is needed.
