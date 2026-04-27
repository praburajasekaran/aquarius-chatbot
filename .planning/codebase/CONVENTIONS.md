# Coding Conventions

**Analysis Date:** 2026-04-24

## Naming Patterns

**Files:**
- Components: PascalCase with `.tsx` extension — `ChatWidget.tsx`, `MessageList.tsx`, `PaymentCard.tsx`
- Utilities/libraries: kebab-case with `.ts` extension — `collect-details.ts`, `match-question.ts`, `handle-completed.ts`
- API routes: lowercase with hyphens — `api/chat/route.ts`, `api/checkout/route.ts`, `api/webhooks/stripe/route.ts`
- Types: `index.ts` for type exports — `src/types/index.ts`

**Functions:**
- Handler functions: `handle` + PascalCase or verb + action — `handleSend()`, `handleMicClick()`, `handlePaymentComplete()`, `handleInputChange()`
- Getter/factory functions: `get` + entity — `getStripe()`, `generateSessionId()`
- Validator functions: `validate` + entity — `validateEmail()`, `validatePhone()`, `validateFileType()`, `validateFileSize()`
- Utility functions: descriptive lowercase with underscores — `isInsideBusinessHours()`, `normalizePhone()`, `findBestMatch()`
- Server action/async functions: descriptive verbs — `createIntake()`, `updateIntake()`, `sendClientInquiryEmail()`
- Tool definitions: lowercase with hyphens exported as camelCase — `selectUrgency`, `collectDetails`, `uploadDocuments`

**Variables:**
- State variables: camelCase — `sessionId`, `dismissedForMessageId`, `lastAssistantMessageId`, `isLoading`, `speechSupported`
- Constants: UPPER_SNAKE_CASE — `INITIAL_WELCOME_CHIPS`, `CLIENT_TOOLS_REQUIRING_CONTINUATION`, `PRICING`, `EMAIL_REGEX`, `AU_PHONE_REGEX`, `MAX_FILE_SIZE`, `FIRM_CONTACT`
- Private module-level state: underscore prefix — `_stripe` in `src/lib/stripe.ts`
- DOM refs: descriptive + `Ref` suffix — `textareaRef`, `recognitionRef`, `scrollRef`, `messagesEndRef`

**Types:**
- Interfaces for component props: `${ComponentName}Props` — `MessageInputProps`, `MessageListProps`, `PaymentCardProps`
- Type annotations: descriptive names for return types — `ChatMessage`, `QAPair`, `SessionData`, `ClientDetails`, `CheckoutUrgency`
- Enum-like types: `Record<string, Type>` or `union` types — `urgency: "urgent" | "non-urgent"`

## Code Style

**Formatting:**
- Next.js 16+ with TypeScript 5+
- No Prettier config; uses ESLint for formatting
- Indentation: 2 spaces

**Linting:**
- Tool: ESLint 9 with `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`
- Config: `src/eslint.config.mjs` (flat config format, not `.eslintrc`)
- Run: `npm run lint`
- Typical suppressions: `eslint-disable-next-line @typescript-eslint/no-explicit-any` for intentional type escapes

**Line length:** No hard limit enforced; code wraps naturally at component/function boundaries

## Import Organization

**Order:**
1. React/Next.js built-in imports (`import { useState } from "react"`, `import { NextResponse } from "next/server"`)
2. Third-party packages (`import Stripe from "stripe"`, `import { tool } from "ai"`, `import { z } from "zod"`)
3. Lucide React icons (`import { SendHorizonal, Mic } from "lucide-react"`)
4. Local library imports (`import { getStripe } from "@/lib/stripe"`, `import type { ChatMessage } from "@/lib/tools"`)
5. Local component imports (`import { MessageList } from "@/components/chat/message-list"`)
6. Type imports on demand with `type` keyword

**Path Aliases:**
- `@/` maps to `src/` — configured in `tsconfig.json` as `"@/*": ["./src/*"]`
- All imports use the `@/` alias; no relative imports
- Example: `import { BRANDING } from "@/lib/branding"` instead of relative paths

**Barrel files:**
- `src/lib/tools/index.ts` exports all tools as a named object `tools` satisfying `ToolSet`
- Components do not use barrel files; import directly from component file

## Error Handling

**Patterns:**
- **Network/external service failures:** Log to console with a contextual prefix in square brackets, then swallow or return a fallback. Example from `src/app/api/checkout/route.ts`:
  ```typescript
  try {
    await updateIntake(sessionId, { stripeSessionId: checkoutSession.id });
  } catch (err) {
    console.error("[checkout] failed to persist stripeSessionId to intake", err);
  }
  ```

- **Validation failures:** Return an object with `valid: false` and `errors` array. Example from `src/lib/tools/collect-details.ts`:
  ```typescript
  if (errors.length > 0) {
    return {
      valid: false,
      errors,
    };
  }
  ```

- **Configuration/missing required env vars:** Throw `new Error()` at initialization time. Example from `src/lib/stripe.ts`:
  ```typescript
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  ```

- **Async/await in handlers:** Wrap in try-catch; log errors with context prefix; do not re-throw to client handlers unless critical
- **Tool execution errors (AI SDK):** Log context prefix; return structured error object or falsy value to inform AI
- **Client-side errors (React):** Set local state (e.g., `setError()`) to display user-friendly message; no console.error for expected failures

## Logging

**Framework:** Native `console` — no logging library used

**Patterns:**
- **Server-side logging:** Always include a contextual prefix in square brackets: `[module-name]`, `[webhook-type]`, or `[function-name]`
  - Examples: `[selectUrgency]`, `[checkout]`, `[late-upload]`, `[stripe-webhook]`, `[smokeball-capture]`
  - Prefix format: `console.error("[context] message", error)`
- **What to log:**
  - `console.error()` for failures that prevent operation (failed to create intake, Stripe webhook failed, Zapier failed)
  - `console.warn()` for non-fatal issues (missing size metadata, missing Smokeball mapping, head() request failed)
  - `console.info()` for successful state transitions (payment confirmed, event booked)
  - `console.log()` for debugging in scripts/tools only
- **Do NOT log on client-side** (React components); use state management instead
- **Do NOT include sensitive data** (passwords, API keys, full email addresses) in logs

**Examples from codebase:**
- Error with context: `console.error("[late-upload] attach zap failed", err)`
- Warning with context: `console.warn("[late-upload] head() failed; proceeding without size", err)`
- Info transitions: `console.info("[stripe-webhook] payment confirmed", { sessionId, email })`

## Comments

**When to Comment:**
- **Explain why, not what:** The code should be readable; explain intent or surprising behavior
- **Tool behavior:** Document AI SDK tool execution semantics (e.g., `showOptions` auto-resolves; `collectDetails` requires validation)
- **Non-obvious state logic:** Comment complex state derivations like `shouldAutoContinue()` or `extractSuggestions()`
- **Workarounds:** Comment temporary fixes or known limitations — see `src/components/chat/message-input.tsx` explaining hydration mismatch avoidance
- **Business logic:** Comment pricing tiers, legal requirements, Australia-specific formatting rules

**Example from codebase** (`src/components/chat/message-input.tsx`):
```typescript
// Server and client must produce the same initial HTML — default to false.
// After hydration, the effect below flips this on if the browser supports
// SpeechRecognition. This avoids a hydration mismatch that would occur if
// we used a lazy useState initialiser (which would evaluate to true on the
// client but false on the server).
const [speechSupported, setSpeechSupported] = useState(false);
```

**JSDoc/TSDoc:**
- Not systematically used in this codebase
- Function documentation relies on TypeScript types and inline comments for complex logic
- Tool descriptions use the AI SDK `description` field (Zod schema property)

## Function Design

**Size:** 
- Average function: 10-30 lines
- Larger functions (50+ lines): Reserved for complex data transformations or business logic
- Example: `handleCompleted()` in `src/lib/late-upload/handle-completed.ts` handles file validation, Zapier webhooks, and notifications — logically grouped but could be split

**Parameters:**
- Prefer destructured object parameters for functions with 3+ arguments
- Example from `src/lib/tools/select-urgency.ts`:
  ```typescript
  execute: async ({
    sessionId,
    urgency,
    clientName,
    clientEmail,
    clientPhone,
    matterDescription,
  }) => { ... }
  ```
- Single simple parameter: pass directly — `handleSend(text: string)`
- Type parameters: always explicit — `<ChatMessage>`, `<CheckoutUrgency>`

**Return Values:**
- Functions return typed objects or primitives, never `void` unless side-effect-only
- Validation functions return `{ valid: boolean; ... }` or `{ valid: boolean; errors: string[] }`
- Async functions return Promises of the value type
- Tool execute functions return `{ matched: true; ... }` or `{ matched: false; fallback: true }`

## Module Design

**Exports:**
- Each file exports one primary entity (component, function, tool, or type)
- Utilities export named functions, not default exports
- Example from `src/lib/validators.ts`: Multiple export functions in one file — `validateEmail()`, `validatePhone()`, `validateFileType()`, etc.
- Types exported as `export type TypeName`

**Barrel Files:**
- Only `src/lib/tools/index.ts` uses a barrel pattern — exports `tools` object and re-exports `ChatMessage`, `ChatTools` types
- Other directories do NOT use barrel files; import directly from the module

## Async Patterns

**Server-Side (Next.js API routes & async functions):**
- Use `async/await` exclusively
- Always handle Promise rejections with try-catch
- Example from `src/app/api/checkout/route.ts`:
  ```typescript
  try {
    await updateIntake(...);
  } catch (err) {
    console.error("[checkout] failed...", err);
  }
  ```

**Client-Side (React components):**
- Use `useCallback` for memoized async handlers
- Use effects to manage async state (fetches, setup)
- Example from `src/components/payment/payment-card.tsx`:
  ```typescript
  const fetchClientSecret = useCallback(async () => {
    const res = await fetch("/api/checkout", {...});
    ...
  }, [sessionId, urgency]);
  ```

## Type Annotations

**Patterns:**
- Always explicitly type function parameters and return types
- Use `type` keyword for type imports to avoid circular dependencies
- Generic constraints are explicit — e.g., `<ChatMessage>` when calling `useChat<ChatMessage>()`
- Object type literals preferred over `any` — when forced to use unknown types, cast with `as unknown as Type` pattern
- Example from `src/components/chat/chat-widget.tsx`:
  ```typescript
  const part = p as { type?: string; state?: string };
  ```

---

*Convention analysis: 2026-04-24*
