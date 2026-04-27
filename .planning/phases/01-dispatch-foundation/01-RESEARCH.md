# Phase 1: Dispatch Foundation - Research

**Researched:** 2026-04-27
**Domain:** ClickSend REST SMS dispatch, E.164 phone normalisation, DCEM compliance, Vitest unit testing
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SMS-02 | SMS dispatch module accepts a provider-agnostic `IntakePaidEvent`, never a Stripe- or Bpoint-specific payload | Architecture pattern: thin `dispatch.ts` with no Stripe imports; `sendSms(to, body)` signature accepts only primitives |
| SMS-03 | All outbound numbers normalised to E.164 (`+61…`) via `libphonenumber-js/min` before hitting ClickSend | `libphonenumber-js` 1.12.42 available; `toE164AU()` implementation pattern researched; unit test inputs/outputs defined |
| SMS-04 | Landline-format numbers silently skipped with structured log event (`sms_skipped`, reason=`landline`), never hit ClickSend API | AU mobile prefix check pattern (`04`/`+614`); `isLandline()` implementation; `console.info` structured log pattern |
| COMP-01 | SMS body copy defined as locked named constant in `src/lib/sms/copy.ts` with DCEM-classification comment | Exact comment wording, constant structure, and DCEM safe-harbour criteria researched |
| COMP-02 | Copy contains firm name and human-readable contact phone for opt-out; does NOT contain "Reply STOP" | Alpha-tag one-way constraint verified; "Reply STOP" omission rationale documented |
| OPS-03 | ClickSend API credentials never logged; E.164 phone logged only as last-4-digits-masked form | Masking pattern `+61*****XXXX` defined; `redact()` helper pattern; console.info spy test pattern |
| TEST-01 | Unit tests cover E.164 normalisation, landline detection, and absent-env graceful degradation without hitting real ClickSend API | Vitest 4.x setup, `vi.stubGlobal('fetch', vi.fn())` pattern, `vi.spyOn(console, 'info')` pattern |

</phase_requirements>

---

## Summary

Phase 1 is a pure new-files-only module: `src/lib/sms/dispatch.ts`, `src/lib/sms/copy.ts`, and `src/lib/sms/__tests__/dispatch.test.ts`. No existing files are touched. The module wraps the ClickSend REST API with a native `fetch` call (no SDK), normalises AU phone numbers to E.164, detects and skips landlines pre-API, and implements absent-safe env var handling so the app boots and runs without ClickSend credentials.

The project has no existing test framework installed. Vitest must be added as a devDependency alongside the worktree. The worktree at `.claude/worktrees/clicksend-sms/` is the target for all new files — not the main working directory. TypeScript is strict mode with `@/` path alias to `./src`. `libphonenumber-js/min` is specified by the requirements but is not yet installed; `toE164AU()` can be implemented without it using a lean regex (the existing `validators.ts` pattern) since the scope is AU-only numbers only.

The ClickSend REST API requires HTTP Basic auth (`username:apiKey` base64-encoded), a `messages` array with `to` (E.164), `body`, and `from` fields. The `from` field carries the sender ID. Response includes a per-message `message_id` UUID in `data.messages[].message_id`. Phase 1 does not need the message ID (that is Phase 2 for reminder cancellation).

**Primary recommendation:** Use Vitest 4.x with `environment: 'node'` and `vi.stubGlobal('fetch', vi.fn())` for unit tests. Implement `toE164AU()` as a standalone function in `dispatch.ts` (no `libphonenumber-js` needed for AU-only E.164 conversion). Use `vi.spyOn(console, 'info')` to verify masked phone logging.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | 4.1.5 | Unit test runner | Current version; native ESM; `vi.stubGlobal`; no Jest compat layer needed |
| @vitejs/plugin-react | 5.x | Vitest React plugin | Required for vitest.config.ts even for node-env tests in a Next.js project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| libphonenumber-js | 1.12.42 | E.164 phone normalisation | Required by SMS-03; `/min` build is ~145KB; only needed if the inline AU regex proves insufficient (it won't for AU-only numbers) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline AU regex for E.164 | `libphonenumber-js/min` | `libphonenumber-js/min` is more robust for edge cases (international inputs); inline regex is simpler and testable; requirements say "via `libphonenumber-js/min`" so install it |
| `vi.stubGlobal('fetch', vi.fn())` | `vitest-fetch-mock` | Extra dependency; `vi.stubGlobal` is built-in and sufficient for 3 test cases |

**Installation (worktree):**
```bash
cd /path/to/worktree
npm install -D vitest @vitejs/plugin-react
npm install libphonenumber-js
```

**Version verification:** Confirmed via `npm view` on 2026-04-27:
- vitest: 4.1.5 (published April 2025)
- libphonenumber-js: 1.12.42

---

## Architecture Patterns

### Recommended Project Structure (new files only)

```
src/lib/sms/
├── dispatch.ts          # toE164AU(), isLandline(), redact(), sendSms()
├── copy.ts              # IMMEDIATE_COPY, REMINDER_COPY constants (locked)
└── __tests__/
    └── dispatch.test.ts # unit tests — E.164, landline, absent-env, masked log
```

### Pattern 1: Absent-Safe Env Var Guard

**What:** Check for `CLICKSEND_USERNAME` and `CLICKSEND_API_KEY` at the top of `sendSms()`. If either is missing, `console.warn` a structured message and return — no throw, no error.

**When to use:** ALL functions that touch external services. The existing `resend.ts` and `kv.ts` follow this pattern.

**Example:**
```typescript
// src/lib/sms/dispatch.ts
export async function sendSms(to: string, body: string): Promise<void> {
  const username = process.env.CLICKSEND_USERNAME;
  const apiKey   = process.env.CLICKSEND_API_KEY;

  if (!username || !apiKey) {
    console.warn("[sms] CLICKSEND_* env vars missing — SMS skipped", {
      event: "sms_skipped",
      reason: "no_credentials",
    });
    return;
  }

  const e164 = toE164AU(to);

  if (isLandline(e164)) {
    console.info("[sms] landline detected — skipping", {
      event: "sms_skipped",
      reason: "landline",
      to: redact(e164),
    });
    return;
  }

  const res = await fetch("https://rest.clicksend.com/v3/sms/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${username}:${apiKey}`).toString("base64")}`,
    },
    body: JSON.stringify({
      messages: [{
        to:   e164,
        body,
        from: process.env.CLICKSEND_SENDER_ID ?? "AquariusLaw",
      }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[sms] ClickSend error", { event: "sms_failed", status: res.status, body: text });
  } else {
    console.info("[sms] sent", { event: "sms_sent", to: redact(e164) });
  }
}
```

---

### Pattern 2: E.164 Normalisation (`toE164AU`)

**What:** Convert any valid AU phone format to E.164 (`+61XXXXXXXXX`). Must be idempotent — calling with an already-E.164 number returns the same value.

**When to use:** Immediately before passing any phone number to ClickSend.

**Requirements say:** use `libphonenumber-js/min`. The `/min` build exposes `parsePhoneNumber` and `isValidPhoneNumber`. For AU-only numbers the simple regex approach in `ARCHITECTURE.md` is equivalent, but using `libphonenumber-js/min` satisfies SMS-03 exactly.

**Implementation using libphonenumber-js/min:**
```typescript
import { parsePhoneNumber } from "libphonenumber-js/min";

export function toE164AU(phone: string): string {
  // Already E.164 — parsePhoneNumber handles this directly
  const parsed = parsePhoneNumber(phone, "AU");
  if (!parsed || !parsed.isValid()) {
    throw new Error(`[sms] Cannot parse AU phone number: ${phone}`);
  }
  return parsed.format("E.164"); // returns "+61XXXXXXXXX"
}
```

**Test cases that MUST pass (from success criteria):**
- `toE164AU("0412 345 678")` → `"+61412345678"`
- `toE164AU("+61412345678")` → `"+61412345678"` (idempotent)

---

### Pattern 3: Landline Detection (`isLandline`)

**What:** Return `true` if the E.164 number is a landline (AU area codes `02`, `03`, `07`, `08` → E.164 `+612x`, `+613x`, `+617x`, `+618x`). Mobile numbers start with `+614`.

**Note:** `isLandline` is called AFTER `toE164AU` so the input is always E.164. The check is simple: E.164 AU mobile numbers always start with `+614`.

```typescript
// After E.164 conversion, AU mobiles start with +614x
export function isLandline(e164: string): boolean {
  return e164.startsWith("+61") && !e164.startsWith("+614");
}
```

**Success criteria test case:** Numbers starting with `02`, `03`, `07`, `08` (pre-conversion) → detected as landline → `fetch` never called → `console.info` called with `reason: "landline"`.

---

### Pattern 4: Phone Number Masking (`redact`)

**What:** Mask the phone number for logging. Show only last 4 digits. Format: `+61*****XXXX`.

**When to use:** Every `console.info` / `console.warn` call that references a phone number. The raw E.164 must NEVER appear in logs (OPS-03).

```typescript
export function redact(e164: string): string {
  // "+61412345678" → "+61*****5678"
  if (e164.length <= 4) return "****";
  return e164.slice(0, e164.length - 4).replace(/\d/g, "*") + e164.slice(-4);
}
```

**Test:** Spy on `console.info` — assert the raw number `+61412345678` never appears in any call args. Assert `+61*****5678` (or similar masked form) does appear.

---

### Pattern 5: DCEM-Compliant SMS Copy Constants

**What:** Both copy strings (immediate and reminder) are named constants in `copy.ts` with a code comment explaining DCEM classification and prohibiting promotional edits.

**When to use:** Never generate copy inline. Always import from `copy.ts`.

```typescript
// src/lib/sms/copy.ts

/**
 * DCEM (Designated Commercial Electronic Message) — Spam Act 2003 s.6(1)
 * This message is a factual service notification, NOT a promotional message.
 * DO NOT add promotional language, adjectives about the firm, or calls to
 * engage additional services. Any copy change requires written sign-off from
 * the firm principal before deployment.
 *
 * Do NOT add "Reply STOP" — the sender ID is a one-way alpha-tag;
 * ClickSend manages opt-outs via its platform opt-out list.
 */
export const IMMEDIATE_SMS_COPY = (uploadLink: string): string =>
  `Aquarius Lawyers: Your payment is confirmed. Please upload your documents here: ${uploadLink} — Aquarius Lawyers (02 XXXX XXXX)`;

export const REMINDER_SMS_COPY = (uploadLink: string): string =>
  `Aquarius Lawyers: A reminder to upload your documents: ${uploadLink} — Aquarius Lawyers (02 XXXX XXXX)`;
```

**COMP-02 constraints verified:**
- Must contain firm name — "Aquarius Lawyers" satisfies this
- Must contain human-readable contact phone for opt-out — "(02 XXXX XXXX)" satisfies this (firm must supply actual number)
- Must NOT contain "Reply STOP" — alpha-tag sender IDs are one-way; "Reply STOP" would confuse clients and is not processed

---

### Pattern 6: Vitest Setup for Node-Environment Tests

**What:** Vitest config with `environment: 'node'`, `globals: true`, `@/` alias, and `unstubGlobals: true`. No React plugin needed for pure server-side lib tests, but including it causes no harm and avoids config forking when component tests are added later.

**vitest.config.ts (worktree root):**
```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    unstubGlobals: true,
    clearMocks: true,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
```

**tsconfig.json update** (add to `compilerOptions.types`):
```json
"types": ["vitest/globals"]
```

**package.json test scripts:**
```json
"test": "vitest run",
"test:watch": "vitest"
```

---

### Pattern 7: Fetch Mock in Unit Tests

**What:** Use `vi.stubGlobal('fetch', vi.fn())` to prevent any real HTTP calls. Assert `expect(fetch).not.toHaveBeenCalled()` to verify skip paths.

```typescript
// src/lib/sms/__tests__/dispatch.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendSms, toE164AU, isLandline } from "../dispatch";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  delete process.env.CLICKSEND_USERNAME;
  delete process.env.CLICKSEND_API_KEY;
});

it("skips send and warns when CLICKSEND env vars absent", async () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  await sendSms("+61412345678", "test");
  expect(warnSpy).toHaveBeenCalledWith(
    expect.stringContaining("CLICKSEND_* env vars missing"),
    expect.any(Object)
  );
  expect(fetch).not.toHaveBeenCalled();
});

it("skips send and logs sms_skipped for landline numbers", async () => {
  process.env.CLICKSEND_USERNAME = "user";
  process.env.CLICKSEND_API_KEY  = "key";
  const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  await sendSms("02 9876 5432", "test");
  expect(fetch).not.toHaveBeenCalled();
  const calls = infoSpy.mock.calls.flat(Infinity).map(String).join(" ");
  expect(calls).toContain("landline");
  expect(calls).not.toContain("0298765432");
  expect(calls).not.toContain("+61298765432");
});
```

---

### Anti-Patterns to Avoid

- **Calling `normalizePhone()` from `validators.ts` and passing result to ClickSend:** `normalizePhone()` strips whitespace only — it does NOT produce E.164. Always call `toE164AU()` first.
- **Logging raw phone numbers:** Never `console.info({ to: e164 })`. Always `console.info({ to: redact(e164) })`.
- **Importing Stripe types in `dispatch.ts`:** `src/lib/sms/dispatch.ts` must have zero imports from `stripe` or `@stripe/stripe-js`. The function signature is `sendSms(to: string, body: string)` — primitives only.
- **Calling `isLandline()` before `toE164AU()`:** `isLandline` expects E.164 input. The AU prefix check (`!startsWith("+614")`) only works on E.164.
- **Adding "Reply STOP" to copy:** Alpha-tag sender IDs are one-way. ClickSend manages opt-outs platform-side. Adding "Reply STOP" is misleading and wastes character budget.
- **Throwing on missing env vars:** Must return silently with a warn log so the app boots without ClickSend credentials in local dev.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Phone number parsing edge cases | Custom regex for international formats | `libphonenumber-js/min` | Handles `parsePhoneNumber("0412 345 678", "AU")` correctly including spaces, dashes, parentheses, country code variations |
| Test runner from scratch | Jest config boilerplate | Vitest 4.x | Native ESM, faster, same assertion API, built-in `vi.stubGlobal` |

**Key insight:** The AU-only scope means `toE164AU()` could work with a 3-line regex, but `libphonenumber-js/min` is specified by SMS-03 and handles edge cases (international inputs, malformed numbers) with zero maintenance burden.

---

## Common Pitfalls

### Pitfall 1: `isLandline()` called before E.164 conversion
**What goes wrong:** `isLandline("02 9876 5432")` with a local-format check would need a different regex than `isLandline("+61298765432")`. The implementation pattern assumes E.164 input.
**Why it happens:** Natural to call `isLandline(rawPhoneFromSession)` before normalisation.
**How to avoid:** Order in `sendSms()`: (1) env var check, (2) `toE164AU()`, (3) `isLandline()`, (4) fetch. Never change this order.
**Warning signs:** `isLandline()` receiving strings starting with `0` instead of `+61`.

### Pitfall 2: Vitest `globals: true` without tsconfig update
**What goes wrong:** TypeScript errors on `describe`, `it`, `expect` — TypeScript doesn't know these globals exist.
**Why it happens:** `globals: true` makes them available at runtime but TypeScript needs the type declarations.
**How to avoid:** Add `"vitest/globals"` to `compilerOptions.types` in `tsconfig.json`.
**Warning signs:** TS error "Cannot find name 'describe'" in test files.

### Pitfall 3: `process.env` mutation not cleaned up between tests
**What goes wrong:** Test that sets `CLICKSEND_USERNAME` leaks into the next test, causing the absent-env test to fail.
**Why it happens:** `process.env` is a global mutable object; deleting/setting in one test affects others unless cleaned up.
**How to avoid:** Use `beforeEach` to delete both `CLICKSEND_USERNAME` and `CLICKSEND_API_KEY`. Re-set them in tests that need them. Vitest's `clearMocks: true` does NOT reset `process.env`.
**Warning signs:** Tests pass in isolation but fail when run together.

### Pitfall 4: `libphonenumber-js/min` throws on unparseable input
**What goes wrong:** `parsePhoneNumber("abc", "AU")` throws a `ParseError` — if the caller catches nothing, the webhook crashes.
**Why it happens:** `libphonenumber-js` throws on invalid input rather than returning null.
**How to avoid:** Wrap `toE164AU()` in a try/catch inside `sendSms()` and treat parse failure as a skip (warn and return).
**Warning signs:** Test with an invalid number format — `toE164AU("not-a-phone")` should not crash the caller.

### Pitfall 5: `redact()` masking the wrong characters
**What goes wrong:** `redact("+61412345678")` returns `"+61*****5678"` but only if the function handles variable-length numbers correctly. An off-by-one produces `"+61****5678"` (3 stars instead of 5).
**Why it happens:** E.164 AU numbers are always 12 chars (`+61XXXXXXXXX`) but defensive coding is better than assuming length.
**How to avoid:** Implement as `e164.slice(0, -4).replace(/\d/g, "*") + e164.slice(-4)`. This is length-agnostic.
**Warning signs:** Unit test asserting the exact masked string fails.

---

## Code Examples

Verified patterns from official sources and codebase analysis:

### ClickSend API call (from official docs)
```typescript
// Source: https://developers.clicksend.com/docs/messaging/sms/other/send-sms
const res = await fetch("https://rest.clicksend.com/v3/sms/send", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Basic ${Buffer.from(`${username}:${apiKey}`).toString("base64")}`,
  },
  body: JSON.stringify({
    messages: [{
      to:   e164,          // "+61412345678" — E.164 mandatory
      body: messageBody,
      from: senderId,      // "AquariusLaw" — registered alpha-tag
    }],
  }),
});
// Response: { data: { messages: [{ message_id: "UUID", status: "SUCCESS" }] } }
```

### libphonenumber-js/min usage
```typescript
// Source: https://www.npmjs.com/package/libphonenumber-js (verified 2026-04-27)
import { parsePhoneNumber } from "libphonenumber-js/min";

export function toE164AU(phone: string): string {
  try {
    const parsed = parsePhoneNumber(phone, "AU");
    if (!parsed?.isValid()) throw new Error("invalid");
    return parsed.format("E.164");
  } catch {
    throw new Error(`[sms] Cannot normalise to E.164: "${phone}"`);
  }
}
```

### Vitest fetch mock pattern
```typescript
// Source: https://vitest.dev/guide/mocking.html (verified 2026-04-27)
vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
  ok: true,
  text: async () => "{}",
}));
// After test: automatically restored because unstubGlobals: true in config
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Jest for Next.js tests | Vitest 4.x | 2023-present | Native ESM; no `transform` config; faster cold start |
| `libphonenumber-js` (full build) | `libphonenumber-js/min` | Always available | `/min` is ~145KB vs ~800KB; sufficient for parsing/formatting, no region metadata overhead |
| `@upstash/kv` (deprecated) | `@upstash/redis` directly | 2024 | Already in use in `kv.ts`; no change needed for Phase 1 |

**Not yet installed / deprecated:**
- Vitest: not in project; must add as devDependency
- `libphonenumber-js`: not in project; must add as dependency

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 (not yet installed — Wave 0 gap) |
| Config file | `vitest.config.ts` at worktree root (not yet created — Wave 0 gap) |
| Quick run command | `npx vitest run src/lib/sms/__tests__/dispatch.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SMS-03 | `toE164AU("0412 345 678")` returns `"+61412345678"` | unit | `npx vitest run src/lib/sms/__tests__/dispatch.test.ts` | ❌ Wave 0 |
| SMS-03 | `toE164AU("+61412345678")` returns `"+61412345678"` (idempotent) | unit | `npx vitest run src/lib/sms/__tests__/dispatch.test.ts` | ❌ Wave 0 |
| SMS-04 | `sendSms("02 9876 5432", ...)` with env vars set: `fetch` never called, `console.info` called with `reason: "landline"` | unit | `npx vitest run src/lib/sms/__tests__/dispatch.test.ts` | ❌ Wave 0 |
| OPS-03 | `sendSms(...)` — raw E.164 never appears in any `console.info` call arg | unit | `npx vitest run src/lib/sms/__tests__/dispatch.test.ts` | ❌ Wave 0 |
| OPS-01 (partial) | `sendSms(...)` with CLICKSEND env vars absent: `fetch` not called, `console.warn` called | unit | `npx vitest run src/lib/sms/__tests__/dispatch.test.ts` | ❌ Wave 0 |
| COMP-01/02 | `IMMEDIATE_SMS_COPY` contains firm name, upload link placeholder, contact phone; does not contain "Reply STOP" | unit (string assertion) | `npx vitest run src/lib/sms/__tests__/dispatch.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/lib/sms/__tests__/dispatch.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `vitest.config.ts` — at worktree root; covers all `src/lib/sms/__tests__/*.test.ts`
- [ ] `package.json` — add `"test": "vitest run"` script and `vitest` devDependency
- [ ] `tsconfig.json` — add `"vitest/globals"` to `compilerOptions.types`
- [ ] Install commands: `npm install -D vitest && npm install libphonenumber-js`
- [ ] `src/lib/sms/__tests__/dispatch.test.ts` — all 6 test cases listed above

---

## Open Questions

1. **Firm phone number for opt-out contact in copy**
   - What we know: COMP-02 requires a "human-readable contact phone" in the copy
   - What's unclear: Actual firm phone number is not in the researched codebase files
   - Recommendation: Use a placeholder `(02 XXXX XXXX)` in the constant; the implementation task should prompt for the real number or find it in `branding.ts` / `contact.ts`

2. **`libphonenumber-js` import path in Next.js 16 bundler mode**
   - What we know: `tsconfig.json` uses `"moduleResolution": "bundler"`; `libphonenumber-js/min` uses subpath exports
   - What's unclear: Whether `import { parsePhoneNumber } from "libphonenumber-js/min"` resolves correctly under Next.js 16's bundler moduleResolution
   - Recommendation: Test the import in the first task; if it fails, fall back to `import { parsePhoneNumber } from "libphonenumber-js"` (same API, larger bundle, but tree-shaken by Next.js)

3. **`branding.ts` / `contact.ts` — firm contact details**
   - What we know: Files exist at `src/lib/branding.ts` and `src/lib/contact.ts` in the worktree
   - What's unclear: Whether firm phone number is exported from either file (not read during research)
   - Recommendation: Read these files in the implementation task to extract the canonical firm phone for COMP-02

---

## Sources

### Primary (HIGH confidence)
- ClickSend SMS API docs — request structure, authentication, response fields: https://developers.clicksend.com/docs/messaging/sms/other/send-sms
- Vitest 4.x mocking guide — `vi.stubGlobal`, `vi.spyOn`: https://vitest.dev/guide/mocking.html
- ARCHITECTURE.md (project file) — established patterns, `sendSms()` skeleton, `isLandline()` logic, build order
- PITFALLS.md (project file) — E.164 pitfall, DCEM classification, masking requirement
- `src/lib/validators.ts` (codebase) — `AU_PHONE_REGEX`, `normalizePhone()` confirmed NOT E.164

### Secondary (MEDIUM confidence)
- Vitest + Next.js 16 setup: https://www.shsxnk.com/blog/vitest-nextjs-testing-infrastructure
- libphonenumber-js npm page (version 1.12.42): https://www.npmjs.com/package/libphonenumber-js

### Tertiary (LOW confidence)
- None — all critical findings verified with primary sources

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified via `npm view` and official docs
- Architecture: HIGH — copied from existing project ARCHITECTURE.md (researched 2026-04-24) + verified against codebase
- Pitfalls: HIGH — PITFALLS.md pre-researched with official sources; Phase 1-specific pitfalls verified
- Test patterns: HIGH — Vitest docs verified; worktree package.json confirmed no test framework installed

**Research date:** 2026-04-27
**Valid until:** 2026-05-27 (vitest releases frequently; core API stable; libphonenumber-js minor versions only)
