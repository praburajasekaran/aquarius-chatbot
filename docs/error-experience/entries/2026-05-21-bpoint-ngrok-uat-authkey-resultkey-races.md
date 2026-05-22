# 2026-05-21 — BPoint ngrok UAT exposed AuthKey and ResultKey races

## What Happened
During local BPoint UAT through ngrok, the chat payment flow showed several contradictory states: `authkey_mismatch`, `pricing lookup failed (404)`, and a false `payment=failed&reason=system` after BPoint had processed the payment. The browser eventually reached `Payment completed successfully` and rendered the upload step after the route-level races were fixed.

## Root Cause
Duplicate concurrent `/api/checkout` setup calls could create more than one AuthKey for the same intake before either request persisted its key. Separately, BPoint `processiframetxn` returned a successful redirect `ResultKey` that `retrieveTransaction(ResultKey)` later reported as `APIResponse.ResponseCode=118 "Invalid transaction number"`, so the confirm route needed a server-recorded fallback from the successful process response.

## Impact
- Severity: P1
- Time lost: about 90 minutes of live UAT debugging

## Fix
Added an atomic Redis `bpoint-authkey:{sessionId}` NX claim so the first checkout setup wins and concurrent losers return the same AuthKey. Added `bpoint-result:{ResultKey}` fallback storage after successful iframe processing and taught the confirm route to use it when BPoint retrieve rejects the redirect ResultKey. Added clearer PaymentCard handling for pre-intake `404` and tightened prompt/tool text to avoid premature payment calls.

## Prevention Rule
For external payment iframes, treat setup, processing, and redirect confirmation as separate race-prone phases; add idempotency/fallback tests for duplicate setup and non-retrievable redirect keys before manual UAT.

## Tags
`bpoint` `payments` `uat` `race-condition` `nextjs`
