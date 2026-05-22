---
phase: 04-validation
verified: pending
status: partial
score: 0/3 SCs verified; TEST-01 browser path partially verified via ngrok-local
last_updated: 2026-05-21
runtime_notes:
  test_surface: "Local Next dev server exposed through ngrok HTTPS"
  ngrok_url: "https://auroral-superethically-hans.ngrok-free.dev"
  app_url_mode: "NEXT_PUBLIC_URL / APP_URL / BPOINT_REDIRECT_BASE_URL pointed at ngrok origin"
  blocker_cleared: "BPoint iframe payment surface can create/process a UAT transaction"
  still_pending: "Receipt email, Zapier/Smokeball evidence, automated UAT smoke suite, firm sign-off"
sign_off:
  firm_rep: pending
  date: pending
  medium: pending
  quote: pending
---

# Phase 04 — UAT Evidence Bundle

**Cutover gate:** TEST-01 ✅ + TEST-02 ✅ + TEST-03 ✅ + firm sign-off.

---

## TEST-01 — Real UAT transaction succeeds end-to-end

| Status | Evidence |
|--------|----------|
| 🟨 partial | 2026-05-21 ngrok-local browser test reached `Payment completed successfully` and rendered `Upload Supporting Documents` after BPoint card entry. Server route/test fixes were required during UAT; see notes below. |

### 2026-05-21 ngrok-local evidence

**Environment**
- Local app: `http://localhost:3000`
- Public HTTPS tunnel: `https://auroral-superethically-hans.ngrok-free.dev`
- Dev server mode: `next dev --webpack` (Turbopack panicked on untracked GSD symlinks at repo root: `bin`, `contexts`, `references`, `templates`, `workflows`)
- Runtime URL env used for the successful path: `NEXT_PUBLIC_URL`, `APP_URL`, and `BPOINT_REDIRECT_BASE_URL` set to the ngrok origin.

**Observed browser result**
- Visitor selected **Non-urgent — $726 (GST inc.)**
- Payment completed through the BPoint iframe.
- Chat displayed `Payment completed successfully.`
- Assistant advanced to document collection.
- `Upload Supporting Documents` UI rendered with optional skip action.

**Issues found and fixed during the run**
- `authkey_mismatch`: duplicate/concurrent `POST /api/checkout` setup calls could create two BPoint AuthKeys for the same intake. Fixed with `bpoint-authkey:{sessionId}` Redis NX claim and default AuthKey reuse in `src/app/api/checkout/route.ts`.
- `pricing lookup failed (404)`: `initiatePayment` could render before `selectUrgency` created an intake. Fixed with clearer PaymentCard not-ready handling plus stricter payment tool/system prompt guard.
- False `payment=failed&reason=system`: BPoint `processiframetxn` returned success, but later `retrieveTransaction(ResultKey)` returned `APIResponse.ResponseCode=118 "Invalid transaction number"`. Fixed by storing a server-recorded `bpoint-result:{ResultKey}` fallback after successful process and using it in the confirm route.

**Local verification commands**
```
npx vitest run tests/checkout-route.test.ts tests/payment-card.test.tsx tests/confirm-route.test.ts
# 3 files passed, 16 tests passed

npx tsc --noEmit
# passed
```

**Still pending before TEST-01 can be marked ✅**
- Receipt email screenshot: local Resend returned `validation_error — API key is invalid`.
- Upload-token URL check from receipt email.
- Automated UAT smoke tests: current `tests/uat` guard expects `.vercel.app`, while this pass used ngrok-local.
- Durable log/evidence capture from a Vercel preview or adjusted ngrok-compatible UAT harness.

### Artefacts
- **Happy-path iframe + redirect screenshot:** `screenshots/sc1-happy-path.png` — *(paste inline once captured)*
- **Receipt email screenshot:** `screenshots/sc1-receipt-email.png`
- **Upload-token URL:** *(paste URL text from receipt email)*
- **Vercel log snippet (`[bpoint-confirm]` line with `bpointTxnNumber` + `Amount` + `IsTestTxn: true`):**
```
(paste here)
```
- **UAT smoke tests green:** `UAT_SMOKE=1 npx vitest run tests/uat/happy-path.test.ts tests/uat/retrieve-transaction.test.ts` → *(paste output)*

---

## TEST-02 — Smokeball invoice line items reconcile byte-for-byte

| Status | Evidence |
|--------|----------|
| ⬜ pending | (fill in after firm screenshot + byte-compare) |

### Byte-compare assertion

**Expected (from `src/lib/pricing.ts`):**
- `PRICING.urgent.lineItem` = `Initial Deposit for Urgent Court Matter`
- `PRICING["non-urgent"].lineItem` = `Legal Strategy Session`

**Observed (transcribed from firm's Smokeball screenshot):**
*(paste exact transcribed text here — must be byte-identical to one of the above)*

**Verdict:** ⬜ MATCH / ⬜ TRUNCATED / ⬜ DRIFTED

### Artefacts
- **Smokeball invoice line screenshot:** `screenshots/sc2-smokeball-invoice-line.png`
- **Zapier run screenshot:** `screenshots/sc2-zapier-run.png`
- **MerchantReference outbound log:** *(paste `grep "MerchantReference" <vercel-log>` output)*

---

## TEST-03 — All four failure paths behave correctly

### §4.1 Declined card (magic expiry 99/05)
| Status | Evidence |
|--------|----------|
| ⬜ pending | |

- Screenshot: `screenshots/sc3-declined.png`
- Log snippet: `[bpoint-confirm]` with `BankResponseCode: "05"` + declined bucket
- UAT test: `UAT_SMOKE=1 npx vitest run tests/uat/declined-card.test.ts` → *(output)*

### §4.2 Expired AuthKey (31-minute wait)
| Status | Evidence |
|--------|----------|
| ⬜ pending | |

- Screenshot: `screenshots/sc3-expired-authkey.png`
- Log snippet: *(paste AuthKey expiry response line)*
- "Start again" button renders + fresh AuthKey created: ⬜ confirmed / ⬜ not yet

### §4.3 Replayed redirect (curl twice)
| Status | Evidence |
|--------|----------|
| ⬜ pending | |

- Log file: `screenshots/sc3-replayed-redirect.log`
- Assertion: exactly 1 `[payments]` fan-out line + exactly 1 `[bpoint-confirm] duplicate ignored` line
- Resend dashboard: exactly 1 receipt delivered for this `bpointTxnNumber`
- Zapier dashboard: exactly 1 transcript POST for this `bpointTxnNumber`
- UAT test: `UAT_SMOKE=1 npx vitest run tests/uat/confirm-replay.test.ts` → *(output)*

### §4.4 Webhook retry (curl twice — Method B)
| Status | Evidence |
|--------|----------|
| ⬜ pending | |

- Log file: `screenshots/sc3-webhook-retry.log`
- Assertion: both POSTs return 200 + exactly 1 fan-out + 1 `[bpoint-webhook] duplicate ignored`
- UAT test: `UAT_SMOKE=1 npx vitest run tests/uat/webhook-retry.test.ts` → *(output)*

---

## Cutover gate

- [ ] TEST-01 ✅ *(partial browser path verified via ngrok-local on 2026-05-21; evidence still incomplete)*
- [ ] TEST-02 ✅
- [ ] TEST-03 ✅ (all four scenarios)
- [ ] Firm sign-off received

### Firm sign-off

**Rep name:** *(fill in)*
**Date:** *(fill in)*
**Medium:** *(email | Slack | other)*
**Verbatim quote:**
> *(paste firm's reply — must include the word "approved" or equivalent explicit ack)*

---

_Bundle template generated by Plan 04-01. Filled in by Plans 04-02/03/04/05._
