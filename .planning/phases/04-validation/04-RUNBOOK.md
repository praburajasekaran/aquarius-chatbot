# Phase 4 — UAT Runbook

**Purpose:** Step-by-step procedure for the operator (Claude/dev) to execute UAT validation against a live Vercel preview + live BPoint UAT, capture evidence, and hand off to the firm for Smokeball sign-off.

**Audience:** Solo operator. Firm participates only in Smokeball verification (§6) and final sign-off (§8).

**Prerequisite (EXTERNAL BLOCKER):** BPoint Hosted Payment Page product must be activated at the facility level. Call BPoint support **1300 766 031**, Support Code **273 516**, merchant **5353109297032146**. Ask: "Enable Hosted Payment Page / iframe (3-party integration) product for merchant 5353109297032146 so the processtxnauthkey API is accessible to SCI user aquarius-chatbot-uat." Until this is confirmed, `createAuthKey` returns `ResponseCode: 2 "Invalid permissions"`. See `.planning/phases/01-foundation/01-VERIFICATION.md`.

---

## §1. Vercel preview deploy

- [ ] Push the Phase 4 branch to origin. Verify preview deploy succeeds in Vercel dashboard.
- [ ] In Vercel dashboard → Project → Settings → Environment Variables, set these for **Preview** scope, **git-branch scoped to the Phase 4 branch**:
  - `BPOINT_API_USERNAME=aquarius-chatbot-uat`
  - `BPOINT_API_PASSWORD=<from 1Password>`
  - `BPOINT_MERCHANT_NUMBER=5353109297032146`
  - `BPOINT_ENV=uat`
- [ ] Note the **branch-alias URL** (format `https://<project>-git-<branch>-<team>.vercel.app`). **DO NOT use the commit-hash alias** — it changes every redeploy and BPoint's per-AuthKey `ServerNotificationUrl` will point to a dead deploy. See `.planning/phases/04-validation/04-RESEARCH.md` Pitfall 1.
- [ ] Set `NEXT_PUBLIC_URL` on the same scope to the branch-alias URL from the previous step.
- [ ] **Redeploy** (env-var changes do NOT apply to existing deployments — see Pitfall 2). Push an empty commit or use Vercel dashboard "Redeploy".
- [ ] `curl -s "$UAT_PREVIEW_URL/api/checkout" -H 'Content-Type: application/json' -d '{"sessionId":"probe","urgency":"urgent"}' | jq .` — expect HTTP 200 `{"authKey":"<uuid>"}` once HPP activation is confirmed; expect `{"error":"Payment session could not be created"}` + server log `[bpoint] ResponseCode 2 Invalid permissions` if still blocked.

## §2. Local env setup (for UAT smoke tests)

- [ ] `vercel env pull .env.uat.local --environment=preview --git-branch=<branch>`
- [ ] `export $(grep -v '^#' .env.uat.local | xargs)`
- [ ] `export UAT_SMOKE=1`
- [ ] `export UAT_PREVIEW_URL=<branch-alias-url>`
- [ ] Verify: `npx vitest run tests/uat --reporter=dot` (expect skipped until `UAT_RESULT_KEY` is set in §3).

## §3. Happy-path transaction (TEST-01)

- [ ] Open `$UAT_PREVIEW_URL` in a browser. Follow the chat flow to the payment step.
- [ ] When PaymentCard renders the BPoint iframe, enter:
  - Card number: `5123456789012346` (MasterCard — from `tests/uat/fixtures/test-pans.ts` TEST_PANS.mastercard)
  - Expiry: `12/29` (NORMAL_EXPIRY — any future-dated value)
  - CVN: `000` (any 3-digit for happy path)
- [ ] Click Pay. Iframe submits. Browser redirects to `/api/checkout/confirm?ResultKey=<uuid>&ResponseCode=0`.
- [ ] Capture screenshot of the success state. Save to `.planning/phases/04-validation/screenshots/sc1-happy-path.png`.
- [ ] From Vercel logs, find the `[bpoint-confirm]` line for this transaction. Copy the `ResultKey` UUID.
- [ ] `export UAT_RESULT_KEY=<uuid>`
- [ ] Confirm receipt email arrived at the test client address; screenshot it → `sc1-receipt-email.png`.
- [ ] Confirm upload-token URL works (open the link in the receipt email). Paste link text into evidence bundle.
- [ ] `UAT_SMOKE=1 npx vitest run tests/uat/happy-path.test.ts tests/uat/retrieve-transaction.test.ts` — expect both green.
- [ ] Record outbound Vercel log line showing `Amount: 132000` (or `72600`) + `IsTestTxn: true` into evidence bundle under TEST-01.

## §4. Failure paths (TEST-03)

### §4.1 Declined card
- [ ] Open preview URL, re-trigger checkout for a NEW session (distinctive `Crn1` like `uat-<date>-declined`).
- [ ] Enter PAN `5123456789012346`, expiry `99/05` (MAGIC_EXPIRY.doNotHonour), CVN `000`. Amount stays at real PRICING ($1,320 or $726 — DO NOT change amount; see Pitfall 3).
- [ ] Click Pay. Expect redirect to `/?payment=failed&reason=declined` or equivalent declined-bucket UI.
- [ ] Capture: iframe screenshot pre-submit + declined-bucket UI screenshot → `sc3-declined.png`.
- [ ] Capture Vercel log snippet showing `[bpoint-confirm]` + `payment not approved` + `BankResponseCode: "05"` + `bpointTxnNumber`. Paste into evidence bundle.
- [ ] `UAT_SMOKE=1 npx vitest run tests/uat/declined-card.test.ts` — expect green.

### §4.2 Expired AuthKey (31-minute wait)
- [ ] Open preview URL, trigger checkout, wait for iframe to render. **Do not submit.**
- [ ] Start a 31-minute timer. Run §4.1, §4.3, §4.4 in parallel during the wait.
- [ ] After 31 minutes, click Pay on the idle iframe.
- [ ] Expect BPoint to return the expired response. UI renders "Payment session expired" + "Start again" button (Phase 2 locked UX).
- [ ] Capture: expired-bucket UI screenshot → `sc3-expired-authkey.png`.
- [ ] Capture Vercel log snippet showing AuthKey expiry response code. Paste into evidence bundle.
- [ ] Click "Start again" — confirm a fresh AuthKey creates and the iframe re-renders (validates Phase 3 resume route).

### §4.3 Replayed redirect (curl)
- [ ] With `UAT_RESULT_KEY` set from §3, run `tests/uat/confirm-replay.test.ts` (hits confirm route twice). Automated test asserts 307 redirect both times.
- [ ] Capture Vercel log tail showing exactly ONE `[payments]` fan-out line + the SECOND confirm-route call logging `[bpoint-confirm] duplicate ignored`. Save to `sc3-replayed-redirect.log`.
- [ ] Capture evidence: exactly one Resend receipt delivered + one Zapier transcript fired for that `bpointTxnNumber`. Check Resend dashboard + Vercel logs.

### §4.4 Webhook retry (curl — Method B)
- [ ] Run `tests/uat/webhook-retry.test.ts` — asserts two POSTs to `/api/webhooks/bpoint?ResultKey=$UAT_RESULT_KEY` both return 200.
- [ ] Capture Vercel log tail showing exactly ONE fan-out + second webhook call logging `[bpoint-webhook] duplicate ignored`. Save to `sc3-webhook-retry.log`.
- [ ] **NOTE:** Natural retry (Method A — briefly disable preview) is NOT reliable per RESEARCH.md Pitfall 4. Curl replay (Method B) is the authoritative induction.

## §5. Zapier verification

- [ ] Confirm with the firm which Smokeball workspace receives the test transcript email (sandbox vs prod). If prod: use distinctive `clientName: "UAT TEST — delete after sign-off"` in intake.
- [ ] Verify Zapier dashboard shows the test transcript POST succeeded. Screenshot the Zap run → `sc2-zapier-run.png`.

## §6. Smokeball reconciliation (TEST-02 — firm action)

- [ ] Hand off to the firm: "Please open Smokeball, find the matter created by Zapier for test transaction `<bpointTxnNumber>`, screenshot the invoice line items, and send me the screenshot."
- [ ] Save firm's screenshot → `sc2-smokeball-invoice-line.png`.
- [ ] Byte-compare the transcribed invoice line text against `PRICING.urgent.lineItem` (`Initial Deposit for Urgent Court Matter`) or `PRICING["non-urgent"].lineItem` (`Legal Strategy Session`), whichever tier was tested.
- [ ] Assertion: `grep -F "Initial Deposit for Urgent Court Matter" .planning/phases/04-validation/04-UAT-EVIDENCE.md` returns 1 match AND the transcribed screenshot text inside the evidence bundle IS the same byte sequence.
- [ ] If truncation observed (e.g. "Initial Deposit for Urgent Court Ma…"): investigate per Pitfall 5 — is truncation at BPoint MerchantReference or Smokeball display?

## §7. Evidence bundle

- [ ] Fill `.planning/phases/04-validation/04-UAT-EVIDENCE.md` per-SC rows with screenshots + log snippets.
- [ ] Mark each SC as ✅ / ❌ in the bundle header.
- [ ] Commit evidence to git (CONTEXT: "lean toward committing since it's design documentation, not customer PII").

## §8. Sign-off

- [ ] Email/Slack the firm: "All three SCs verified green — please review `.planning/phases/04-validation/04-UAT-EVIDENCE.md` and reply with 'approved' or issues."
- [ ] Quote the firm's reply verbatim in the evidence bundle footer: `name, date, medium, exact text`.

## §9. Rollback procedure (cutover safety)

**Trigger:** Post-cutover incident (checkout broken, webhook fan-out silent, receipt emails failing, Smokeball ingest stopped). Decision owner: firm ops lead. Target RTO: ≤5 minutes.

### §9.1 Vercel redeploy to last known-good

- [ ] Identify last known-good commit on `main` (BEFORE the Phase 4 cutover merge). Check `git log --oneline main` — pick the commit that was in production immediately before Phase 4 went live.
- [ ] Option A (dashboard, ≤3 min): Vercel Dashboard → Project → Deployments → find the Production deployment for that commit SHA → click ⋯ → "Promote to Production" (or "Redeploy"). Confirm. Vercel rolls the alias in <60s.
- [ ] Option B (CLI, ≤2 min): `vercel rollback <deployment-url>` where `<deployment-url>` is the last-known-good deployment URL from `vercel list`. Example: `vercel rollback https://aquarius-chatbot-abc123.vercel.app --scope=<team>`.
- [ ] Verify: `curl -s https://aquariuslawyers.com.au/api/checkout -H 'Content-Type: application/json' -d '{"sessionId":"rollback-probe","urgency":"urgent"}' | jq .` returns a valid BPoint authKey shape (rollback is effective when checkout works end-to-end, not just when the deploy changes).
- [ ] Sanity: visit `https://aquariuslawyers.com.au` in an incognito window, trigger chat to payment step, confirm iframe renders.

### §9.2 Reminder: Stripe is gone

Rollback means reverting to an **earlier BPoint commit** — NOT reverting to Stripe.
- `src/lib/stripe.ts` was deleted in Phase 3-04
- `src/app/api/webhooks/stripe/route.ts` was deleted in Phase 3-04
- `stripe`, `@stripe/stripe-js`, `@stripe/react-stripe-js` were uninstalled
- Any commit that still has Stripe code is pre-Phase-3 and will not build cleanly against current env vars (STRIPE_* variables are removed from Vercel prod env)

If a true "fully back to Stripe" rollback becomes necessary (unexpected), it requires a separate restoration PR + Stripe package reinstall + Vercel env var restoration. Not part of this runbook.

### §9.3 Manual fan-out replay (for partial failures)

Use when: Cutover succeeded but a downstream step failed for a specific transaction (e.g. Resend 5xx blocked a receipt email, Zapier filter rejected the transcript, Upstash Redis was briefly unavailable when upload-token was being created).

The shared fan-out helper `src/lib/payments/handleConfirmedPayment.ts` executes five sequential steps. Each can fail independently; re-run only the failed step(s):
- `"session-update"` — Redis session mark-as-paid (step 1, `updateSession` in kv.ts)
- `"upload-token"` — upload-token creation + dedup key upgrade (steps 2–3, `createUploadToken` + `redis.set`)
- `"receipt-email"` — Resend receipt to client (step 4, `resend.emails.send` with `PaymentReceipt`)
- `"transcript-email"` — Zapier transcript → Smokeball Create Matter (step 5, `sendTranscriptEmail` in resend.ts)

- [ ] **Locate the failure:** `vercel logs <production-url> | grep "\[payments\]" | tail -20`. Copy the `bpointTxnNumber` + `sessionId` + the step that threw from the error line. Note: current code logs errors with `[payments]` prefix but does not include a structured `phase` field — identify the failed step from the error message text or stack trace.
- [ ] **Decide replay step(s):** fan-out steps are independent — replay only the failed phase(s), not all five.
- [ ] **Replay via one-off script** (preferred): create a scratch file `scripts/replay-fanout.ts` that imports `handleConfirmedPayment` + the phase-specific helper, and invokes ONLY the failed step against the stored intake for that `bpointTxnNumber`. Run with `npx tsx scripts/replay-fanout.ts <bpointTxnNumber> <phase>`. Remove the script after use (do not commit).
- [ ] **Replay via direct helper invocation** (fallback, for `receipt-email` only): open a Node REPL on the production env (`vercel dev --prod-env`) and call `sendReceiptEmail({...intake})` directly after fetching the intake from Redis.
- [ ] **Do NOT delete the `bpoint-txn:{TxnNumber}` dedup key** — the dedup namespace protects against accidental double-fan-out from webhook retries. Replay the specific phase directly; don't reset the lock.
- [ ] **Confirm remediation:** Resend dashboard shows the re-sent email; Zapier Task History shows the re-fired transcript task; Redis `bpoint-txn:{TxnNumber}` key still present.

### §9.4 Escalation

If rollback fails OR the incident is >15 minutes old without resolution:
- Contact BPoint support (1300 766 031) — could be BPoint-side outage
- Contact Vercel support (dashboard → Help)
- Page firm ops lead — they own the decision to hold/resume the chat's payment step (can disable the payment-card feature flag if one exists, or render a "payments temporarily unavailable" message)

## §10. Warnings (do NOT violate)

- Do NOT change PRICING amounts for testing (breaks TEST-02 reconciliation + flips BPoint response-code sim). Use magic expiry `99XX` instead. See Pitfall 3.
- Do NOT use commit-hash Vercel URL for `NEXT_PUBLIC_URL`. See Pitfall 1.
- Do NOT forget to redeploy after env-var changes. See Pitfall 2.
- Do NOT add `tests/uat/**` to CI. See Pitfall 6.
- Do NOT run UAT tests against production. `assertPreviewUrl()` enforces `.vercel.app` substring. See Pitfall 7.
- Do NOT rely on natural webhook retry (Method A). Curl replay (Method B) is authoritative. See Pitfall 4.
