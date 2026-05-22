---
phase: 04-re-engagement-framework-payment-abandonment
reviewed: 2026-05-07T13:10:35Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - src/lib/email-reminders/format-matter.ts
  - src/lib/email-reminders/state.ts
  - src/lib/email-reminders/dispatch.ts
  - src/lib/email-reminders/unsubscribe.ts
  - src/lib/email-reminders/copy.ts
  - src/lib/email-reminders/__tests__/format-matter.test.ts
  - src/lib/email-reminders/__tests__/dispatch.test.ts
  - src/lib/digest/activity-log.ts
  - src/lib/email/templates/reengagement-payment.tsx
  - src/app/api/webhooks/email-reminder/route.ts
  - src/app/api/email/unsubscribe/route.ts
  - src/app/unsubscribed/page.tsx
  - src/lib/tools/select-urgency.ts
  - src/lib/intake/handle-paid.ts
findings:
  critical: 3
  warning: 6
  info: 4
  total: 13
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-05-07T13:10:35Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Phase 4 ships a QStash-driven email-reminder framework with HMAC-signed
one-click unsubscribe and a React Email template. The two-key idempotency
contract (cancel-lookup + delivery NX) is correctly implemented and the
absent-env "warn-and-skip" discipline is consistent across modules.

However, the route handler in `src/app/api/webhooks/email-reminder/route.ts`
contains three correctness defects that make the email delivery silently
fail under realistic operational conditions:

1. **Production sign-off guard runs AFTER the NX claim is taken** — when
   `assertCopyApproved()` throws, the claim is held and every QStash retry
   short-circuits at the dedup gate. No email ever sends.
2. **Resume + unsubscribe URLs become relative when `APP_URL` is missing** —
   the in-code comment claims this is "graceful degradation," but mail
   clients cannot resolve relative `href`s. The unsubscribe link in the
   email is unclickable, which is the COMP-02 opt-out mechanism.
3. **Unhandled exceptions from `getIntake()` / `signUnsubscribeToken()`
   leak the NX claim** — Redis hiccups during intake load propagate as
   500s with the claim held, deduplicating all retries.

There is also an environment-variable mismatch between
`scheduleEmailReminder` (uses `APP_URL`) and `select-urgency.ts` (uses
`NEXT_PUBLIC_URL` for the resume URL fed into `sendFirmLeadEmail`). The
Phase 3 SMS reminder uses `APP_URL` too, so this is a long-standing dual
convention rather than something Phase 4 introduced — but the new
reminder email's `resumeUrl` is constructed from a different env var than
the rest of the checkout flow, so links can disagree across channels.

The unsubscribe HMAC implementation is correct (constant-time compare with
length-equal short-circuit). The activity-log helper is properly isolated.
The format-matter tests are thorough.

## Critical Issues

### CR-01: `assertCopyApproved()` runs after NX claim — production failures are deduplicated and never retried

**File:** `src/app/api/webhooks/email-reminder/route.ts:87-107`
**Issue:** Order of operations:

```ts
// Line 87-100
const claimed = await tryClaimDelivery(type, sessionId, DELIVERY_NX_TTL_SECONDS);
if (!claimed) { /* dedup short-circuit */ }

// Line 107 — runs AFTER the NX key is set
assertCopyApproved();
```

If `assertCopyApproved()` throws in production (any locked-copy field
still `PENDING_SIGNOFF`), the NX key
`email-reminder-sent:{type}:{sessionId}` has already been written with a
7-day TTL. The handler returns 500, QStash retries, but the second
delivery hits `tryClaimDelivery` → returns false → handler returns
`"deduped"` with status 200. The email never sends and QStash stops
retrying.

The in-code comment on line 105-106 explicitly states "If this throws in
production, QStash will retry — which is correct" — but that retry is
silently consumed by the dedup gate. This contradicts the documented
intent and turns a copy-approval miss into a permanent silent failure
across the entire payment-abandonment cohort for 7 days.

**Fix:** Move `assertCopyApproved()` ahead of the NX claim, OR release the
NX claim when it throws.

```ts
// Option A — move the guard ahead of the claim
if (await isUnsubscribed(sessionId)) { /* ... */ }

// Decision 1: production guard runs BEFORE the NX claim so a failed
// assertion can be retried.
assertCopyApproved();

const claimed = await tryClaimDelivery(type, sessionId, DELIVERY_NX_TTL_SECONDS);
if (!claimed) { /* ... */ }
```

```ts
// Option B — release on throw
try {
  assertCopyApproved();
} catch (err) {
  await redis.del(deliveryNxKey(type, sessionId));
  throw err;
}
```

Option A is cleaner: the guard does no I/O, so checking it before the
claim costs nothing.

---

### CR-02: `getIntake()` failure leaks the NX claim and silences all retries

**File:** `src/app/api/webhooks/email-reminder/route.ts:111-121`
**Issue:**

```ts
const intake = await getIntake(sessionId);
if (!intake) { /* warn + return without releasing NX claim */ }
```

`getIntake` calls `redis.get(intakeKey(sessionId))`. If Redis is
transiently unreachable (auth blip, network hiccup), the call throws an
exception that propagates out of `handleEmailReminderDelivery`. The NX
claim taken on line 87-91 is held with a 7-day TTL. QStash retries are
silently deduplicated.

The `if (!intake)` branch (line 112) is also a soft swallow: a missing
intake at delivery time is plausibly recoverable (the 7d intake TTL is
longer than the 24h reminder window, but a manual TTL truncation, a
session-key collision, or a Redis flush could legitimately remove the
record before the delivery handler reads it). The comment "intake is
gone, retries can't help" is true ONLY if retries fire within seconds —
QStash retries can fire over hours, and the intake Redis key itself
might be transiently missing. In every case, holding the claim for 7
days when the actual delivery never happened is the wrong default.

**Fix:**

```ts
let intake;
try {
  intake = await getIntake(sessionId);
} catch (err) {
  console.error("[email-reminder] getIntake threw — releasing claim", {
    event: "email_reminder_failed",
    reason: "intake_load_failed",
    sessionId,
    type,
    err: err instanceof Error ? err.message : String(err),
  });
  await redis.del(deliveryNxKey(type, sessionId));
  return new Response("intake_load_failed", { status: 500 });
}
if (!intake) {
  console.warn("[email-reminder] intake missing — releasing claim", { /* ... */ });
  await redis.del(deliveryNxKey(type, sessionId));
  return new Response("intake_missing", { status: 410 }); // Gone — don't retry
}
```

If the deliberate "do not retry intake-missing" semantics are correct,
return a 4xx (not 200) to signal QStash to stop, AND release the claim
so a manual replay of the QStash message after intake is re-seeded can
still send. Returning 200 with the claim held is the worst of both
worlds.

---

### CR-03: Unsubscribe link is unclickable when `APP_URL` is unset — breaks COMP-02 opt-out

**File:** `src/app/api/webhooks/email-reminder/route.ts:129-146`
**Issue:**

```ts
const appUrl = process.env.APP_URL;
if (!appUrl) {
  console.warn("[email-reminder] APP_URL missing — links will be relative", { /* ... */ });
}
const baseUrl = appUrl ?? "";
const resumeUrl = `${baseUrl}/api/checkout/resume?session=...`;
const unsubscribeUrl = `${baseUrl}/api/email/unsubscribe?session=...&token=...`;
```

The in-code comment claims "the resume + unsubscribe links degrade to
relative URLs the visitor can paste into the browser." This is false:

1. Email clients (Gmail, Outlook, Apple Mail, all webmail) render `<a
   href="/api/...">` against their OWN domain (`mail.google.com`,
   `outlook.com`, etc.), not against the firm's domain. The resulting
   404 is on the email client, not the firm's site, so the visitor
   cannot "paste into the browser" — there's nothing useful to paste.
2. The unsubscribe link IS the opt-out mechanism (per copy.ts COMP-02
   comment: "the one-click unsubscribe link IS the opt-out mechanism").
   A broken unsubscribe link in a sent email is a Spam Act
   compliance defect, not graceful degradation.
3. If the email *should not* be sent without working links, the handler
   should refuse to send (release the NX claim, return 500 so QStash
   retries after the env var is fixed) rather than send a broken
   message that consumes the recipient's one piece of latitude.

**Fix:** Treat absent `APP_URL` the same as absent `RESEND_FROM_EMAIL`
(line 148-159) — release the claim and short-circuit:

```ts
const appUrl = process.env.APP_URL;
if (!appUrl) {
  console.error("[email-reminder] APP_URL missing — refusing to send broken links", {
    event: "email_reminder_failed",
    reason: "no_app_url",
    sessionId,
    type,
  });
  await redis.del(deliveryNxKey(type, sessionId));
  return new Response("no_app_url", { status: 500 });
}
```

This matches the discipline applied to `RESEND_FROM_EMAIL` 19 lines
later and eliminates a Spam Act compliance hazard.

## Warnings

### WR-01: `signUnsubscribeToken` returning null still produces an email with an unverifiable unsubscribe link

**File:** `src/app/api/webhooks/email-reminder/route.ts:141-146`
**Issue:**

```ts
const token = signUnsubscribeToken(sessionId);
const unsubscribeUrl = `${baseUrl}/api/email/unsubscribe?session=...&token=${encodeURIComponent(token ?? "")}`;
```

When `EMAIL_REMINDER_UNSUBSCRIBE_SECRET` is absent, `signUnsubscribeToken`
returns `null` (logged in `unsubscribe.ts:21-26`). The route handler
fills the URL with `token=` (empty string) and continues. The
unsubscribe handler will reject the empty token with 400. Result: the
email is sent, the visitor cannot unsubscribe, and the rate of "unsub
attempts that 400" climbs silently.

This is the same compliance hazard as CR-03 but via a different env var.
The Spam Act 2003 opt-out requirement is not met when the only
unsubscribe affordance in the email is a deterministic 400.

**Fix:** Treat `signUnsubscribeToken === null` as an unrecoverable
configuration error, release the claim, return 500 so the deploy is
fixed before any visitor receives a broken email.

```ts
const token = signUnsubscribeToken(sessionId);
if (!token) {
  console.error("[email-reminder] unsubscribe token unsignable — refusing to send", {
    event: "email_reminder_failed",
    reason: "no_unsubscribe_secret",
    sessionId,
    type,
  });
  await redis.del(deliveryNxKey(type, sessionId));
  return new Response("no_unsubscribe_secret", { status: 500 });
}
```

---

### WR-02: `select-urgency.ts` constructs `resumeUrl` from `NEXT_PUBLIC_URL`, but the reminder route uses `APP_URL` — links can disagree across channels

**File:** `src/lib/tools/select-urgency.ts:98`,
`src/app/api/webhooks/email-reminder/route.ts:129`
**Issue:** Two `resumeUrl`s for the same session are built from
different env vars:

- `select-urgency.ts:98` → `process.env.NEXT_PUBLIC_URL ?? ""` →
  passed into `sendFirmLeadEmail` and (indirectly) the firm-facing
  records.
- `email-reminder/route.ts:129` → `process.env.APP_URL` → embedded
  into the visitor's 1h / 24h reminder emails.

If only one of these two env vars is set in a given environment, the
firm sees one resume URL and the visitor receives a different (or
relative, see CR-03) URL for the same session. This creates a
correlation gap in incident response and fails closed only on the
visitor side.

The Phase 3 SMS reminder also uses `APP_URL`, so this dual convention
predates Phase 4 — but Phase 4 had the opportunity to consolidate and
did not. Leaving it split increases the blast radius of an env-var
misconfig at deploy.

**Fix:** Standardise on a single env var across the project (preferably
`APP_URL` since `NEXT_PUBLIC_URL` is exposed to the browser and not
required for server-side resume URL construction). Add a thin helper
`getAppBaseUrl()` and use it everywhere a resume URL is built.

---

### WR-03: `format-matter.ts` truncates abbreviations like "Mr.", "Dr." mid-name

**File:** `src/lib/email-reminders/format-matter.ts:28-29`
**Issue:** The first-sentence split uses `/[.!?]\s/`. Common
salutations and titles in legal-matter descriptions ("Mr. Smith
called...", "Dr. Jones is the complainant...", "St. Vincent's...")
trigger the split:

```ts
snippetMatter("Mr. Smith was charged with assault. Wants to plead.")
// → "Mr"   (loses the rest of the sentence)
```

For a Phase-4 re-engagement email whose 24h variant inserts the
snippet inline as "Re: your inquiry about — {snippet}" (template
line 96), this can produce comically truncated subject hints like
"Re: your inquiry about — Mr". The behaviour is consistent with the
existing test fixture (`First sentence about a matter. Second
sentence.` → `First sentence about a matter`) but the test suite
does not exercise the abbreviation case, so the regression went
unnoticed.

**Fix:** Either widen the regex to require a capital-letter or
non-abbreviation context after the punctuation, or fall back to the
120-char-truncate path when the candidate first segment is shorter
than some sanity floor (e.g., 8 chars). A pragmatic fix:

```ts
// Skip a first-sentence terminator if the resulting segment is
// implausibly short — likely an abbreviation, not a sentence end.
const parts = normalised.split(/[.!?]\s/);
let firstSentence = parts[0] ?? normalised;
if (firstSentence.length < 8 && parts.length > 1) {
  // Re-join up to a longer plausible sentence.
  firstSentence = normalised.split(/(?<=[.!?])\s/).reduce((acc, seg) => {
    if (acc.length >= 8) return acc;
    return acc.length === 0 ? seg : `${acc} ${seg}`;
  }, "");
  // Strip trailing terminator.
  firstSentence = firstSentence.replace(/[.!?]$/, "").trim();
}
```

Add a test:
```ts
it("does not truncate at common abbreviations like 'Mr.'", () => {
  expect(snippetMatter("Mr. Smith was charged with assault.")).toBe(
    "Mr Smith was charged with assault"
  );
});
```

---

### WR-04: `signUnsubscribeToken` does not normalise the sessionId — trailing whitespace mismatches will accept different tokens

**File:** `src/lib/email-reminders/unsubscribe.ts:18-28`
**Issue:** `signUnsubscribeToken("sess-A")` and
`signUnsubscribeToken("sess-A ")` (trailing space) produce different
HMACs. If anywhere in the call chain the sessionId is whitespace-
sensitive but elsewhere it gets `.trim()`'d, the token will fail
verify. The unsubscribe URL passes the sessionId through
`encodeURIComponent`, so URL parsing preserves spaces — meaning the
URL form may legitimately differ from the form used in `tryClaim` /
`isUnsubscribed`.

This is a low-likelihood bug because `select-urgency.ts:39-42`
trims the session inputs at intake creation. But the dispatch flow
takes the sessionId from the QStash payload (which is whatever the
scheduling code wrote, line 67 of dispatch.ts) and the verify path
takes it from `url.searchParams.get("session")` (decoded but not
trimmed). A leaked or hand-rolled URL with a trailing space will
silently fail verification with no diagnostic.

**Fix:** Normalise the sessionId in `signUnsubscribeToken` and
`verifyUnsubscribeToken` (trim, optionally lowercase) so both sides
agree, and document the invariant.

```ts
function normaliseSessionId(s: string): string {
  return s.trim();
}
```

---

### WR-05: HMAC comparison's length-equality short-circuit leaks early on tokens that match in length but differ in content — but only by one branch

**File:** `src/lib/email-reminders/unsubscribe.ts:48-49`
**Issue:** `if (expectedBuf.length !== providedBuf.length) return false;`
is a non-constant-time check. An attacker who can repeatedly call the
unsubscribe endpoint and time the response can distinguish "wrong
length" from "right length, wrong content." The HMAC is base64url of
SHA-256 (always 43 chars), so the only practical attack here is
distinguishing a *correctly-sized* candidate token from a
*mis-sized* one — which is information of essentially zero value to
an attacker since they already know the expected length.

This is not a meaningful crypto vulnerability. However, the typical
defensive idiom is to compare against a fresh HMAC of a constant
string when lengths differ, so the timing remains independent of the
input. The current code is acceptable but worth annotating.

**Fix (optional):** If you want to remove even the theoretical
length-leak, compare against a same-length zero buffer when lengths
differ:

```ts
if (expectedBuf.length !== providedBuf.length) {
  // Constant-time false: still hit timingSafeEqual to keep timing flat.
  timingSafeEqual(expectedBuf, Buffer.alloc(expectedBuf.length, 0));
  return false;
}
```

This is defensive, not load-bearing.

---

### WR-06: `reengagement-payment.tsx` table has no inline styles — guaranteed to render unstyled in some email clients

**File:** `src/lib/email/templates/reengagement-payment.tsx:69-90`
**Issue:** The LSS explainer table uses bare `<th>` and `<td>` with no
inline styles for padding, font, color, or background. Outlook desktop
(2007–2019), several Outlook for Android variants, and a small set of
older Lotus Notes builds will render this as unstyled, edge-to-edge
black-on-white text with no separators.

`@react-email/components` provides primitives (`Section`, `Row`,
`Column`) that emit MSO-safe table HTML. Using them — or supplying
inline styles per cell — is the standard remedy.

**Fix:** Replace the bare table with `Row`/`Column` from
`@react-email/components`, or add inline `style` props per cell:

```tsx
<table
  style={{ width: "100%", borderCollapse: "collapse" }}
  cellPadding={8}
  cellSpacing={0}
  role="presentation"
>
  <thead>
    <tr>
      <th align="left" style={{ padding: "8px", borderBottom: "1px solid #ddd", fontFamily: "'Open Sans', sans-serif" }}>
        {LSS_EXPLAINER_BLOCK.urgentTitle}
      </th>
      {/* ... */}
    </tr>
  </thead>
  {/* ... */}
</table>
```

This issue does not block correctness — placeholder copy is
`PENDING_SIGNOFF` and the template will not render in production until
sign-off lands — but the production-ready template should be styled
before sign-off, not after.

## Info

### IN-01: `select-urgency.ts` swallows reminder-scheduling failures silently inside a try/catch that wraps two awaits

**File:** `src/lib/tools/select-urgency.ts:118-130`
**Issue:**

```ts
try {
  await scheduleEmailReminder("payment-abandonment-1h", sessionId, 3600);
  await scheduleEmailReminder("payment-abandonment-24h", sessionId, 86400);
} catch (err) { /* logs and swallows */ }
```

If the 1h schedule succeeds but the 24h schedule throws, the function
logs only the 24h failure. The 1h reminder is still pending in QStash,
but the visitor will not receive the 24h follow-up. The cancellation
side (handle-paid.ts:322-341) cancels both unconditionally, so the
asymmetry doesn't cause a leak — but ops has no signal that the 24h
arm of the cohort is missing.

**Fix:** Schedule each reminder in its own try/catch so a partial
schedule is reportable:

```ts
try {
  await scheduleEmailReminder("payment-abandonment-1h", sessionId, 3600);
} catch (err) { /* log */ }
try {
  await scheduleEmailReminder("payment-abandonment-24h", sessionId, 86400);
} catch (err) { /* log */ }
```

---

### IN-02: `dispatch.test.ts:73-78` partial-mock pattern uses `vi.importActual` but does not stub anything — the spread is a no-op

**File:** `src/lib/email-reminders/__tests__/dispatch.test.ts:73-78`
**Issue:**

```ts
vi.mock("@/lib/digest/activity-log", async () => {
  const actual = await vi.importActual<{ logActivity: ... }>(...);
  return { ...actual };
});
```

This mock declaration is functionally identical to omitting the mock
entirely. The comment claims it's a "contract surface that Plan
04-02's implementation must satisfy" — but spreading the actual export
without override does nothing the natural import wouldn't already do.
If the intent is to assert the module exists with a `logActivity`
export of the right shape, that belongs in a separate type-level test,
not as a runtime mock.

**Fix:** Delete the mock. The test will use the real module
automatically, which is what it does today.

---

### IN-03: `state.ts` exports unused helpers (delivery-NX `tryClaimDelivery` is duplicated by inline `redis.set` in dispatch.test.ts:215)

**File:** `src/lib/email-reminders/state.ts:55-65`,
`src/lib/email-reminders/__tests__/dispatch.test.ts:215`
**Issue:** The test mocks `redis.set` returning `"OK"` and asserts the
call shape, exercising `tryClaimDelivery` indirectly. There's no test
for the not-claimed branch (`redis.set` returns `null`). Coverage of
the dedup race is incomplete.

**Fix:** Add a test:

```ts
describe("handleEmailReminderDelivery — duplicate delivery dedup", () => {
  it("returns 'deduped' when NX claim fails", async () => {
    vi.mocked(redis.get).mockResolvedValue(null as never);
    vi.mocked(redis.set).mockResolvedValue(null as never); // NX miss
    const res = await handleEmailReminderDelivery(makeDeliveryRequest({
      sessionId: "sess-dup", type: "payment-abandonment-1h",
    }));
    expect(await res.text()).toBe("deduped");
    expect(resendSendMock).not.toHaveBeenCalled();
  });
});
```

---

### IN-04: `unsubscribed/page.tsx` hardcodes the brand colour `#61BBCA` instead of using `BRANDING`

**File:** `src/app/unsubscribed/page.tsx:40`
**Issue:** The "Return to homepage" button hardcodes
`background: "#61BBCA"`. CLAUDE.md notes the brand is `#61BBCA` and
Tailwind is configured with the `brand` token, but the rest of the
page uses inline styles for fonts. For whitelabel deployments where
`BRANDING.firmName` differs, the colour stays Aquarius-blue.

**Fix:** Either pull the colour from `BRANDING` if a colour field is
added there, or use the Tailwind `brand` utility:

```tsx
<Link href="/" className="inline-block px-6 py-3 rounded-md text-white bg-brand">
  Return to homepage
</Link>
```

This makes the page consistent with the rest of the codebase's brand
discipline.

---

_Reviewed: 2026-05-07T13:10:35Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
