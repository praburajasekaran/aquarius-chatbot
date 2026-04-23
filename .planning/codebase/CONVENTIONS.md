# Coding Conventions

**Analysis Date:** 2026-04-23

## Naming Patterns

**Files:**
- Components: kebab-case with `.tsx` extension (e.g., `message-input.tsx`, `payment-card.tsx`, `urgent-contact-card.tsx`)
- Utilities/Functions: kebab-case with `.ts` extension (e.g., `collect-details.ts`, `match-question.ts`, `system-prompt.ts`)
- API routes: kebab-case directory structure matching endpoint paths (e.g., `src/app/api/checkout/route.ts`, `src/app/api/webhooks/stripe/route.ts`)
- Interfaces/Types: PascalCase (e.g., `SessionData`, `ClientDetails`, `IntakeRecord`, `ChatMessage`)
- Constants: UPPER_SNAKE_CASE (e.g., `SESSION_TTL`, `MAX_FILES_PER_SESSION`, `ALLOWED_FILE_TYPES`)
- Private constants in modules: UPPER_SNAKE_CASE (e.g., `EMAIL_REGEX`, `AU_PHONE_REGEX`, `MAX_FILE_SIZE`)

**Functions:**
- Regular functions: camelCase (e.g., `validateEmail`, `normalizePhone`, `createSession`, `updateIntake`)
- React components: PascalCase (e.g., `ChatWidget`, `MessageInput`, `PaymentCard`)
- Handler functions in components: camelCase prefixed with `handle` (e.g., `handleSend`, `handlePaymentComplete`, `handleUploadComplete`, `handleKeyDown`)
- Tool definitions: camelCase as exported const (e.g., `collectDetails`, `matchQuestion`, `uploadDocuments`)
- Getter functions: `get` prefix (e.g., `getSession`, `getIntake`, `getStripe`)

**Variables:**
- State variables: camelCase (e.g., `input`, `error`, `sessionId`, `messages`)
- Refs: camelCase with `Ref` suffix (e.g., `textareaRef`, `messagesEndRef`, `scrollRef`)
- Props interfaces: PascalCase with `Props` suffix (e.g., `MessageInputProps`, `PaymentCardProps`, `MessageListProps`)
- Local destructured objects: camelCase (e.g., `{ sessionId, urgency }`, `{ name, email, phone }`)

**Types:**
- Interfaces: PascalCase (e.g., `SessionData`, `ClientDetails`, `UploadTokenRecord`, `IntakeRecord`)
- Type aliases: PascalCase (e.g., `CheckoutUrgency`, `AllowedContentType`, `IntakeUrgency`)
- Generic type names: `T`, `U`, `K`, `V` (single uppercase letters for generics)

## Code Style

**Formatting:**
- ESLint config: `eslint.config.mjs` using `eslint-config-next` (core web vitals + TypeScript)
- No Prettier config detected — use ESLint defaults
- Line breaks: Unix (`\n`)
- Indentation: 2 spaces (inferred from codebase)
- Semicolons: Required (enforced by ESLint)

**Linting:**
- Tool: ESLint 9 with Next.js core web vitals and TypeScript configs
- Extends: `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`
- Global ignores: `.next/**`, `out/**`, `build/**`, `next-env.d.ts`
- Run: `npm run lint` (command in `package.json`)

## Import Organization

**Order:**
1. External packages (React, Next.js, third-party libraries)
2. Type imports from external packages (`type { ... } from "..."``)
3. Internal lib imports (`@/lib/...`)
4. Internal component imports (`@/components/...`)
5. Type imports from internal modules (`type { ... } from "@/..."``)
6. Relative imports (rare, not observed in codebase)

**Path Aliases:**
- Primary: `@/*` maps to `./src/*` (configured in `tsconfig.json`)
- Usage: All imports use the `@/` prefix (e.g., `@/lib/tools`, `@/components/chat`, `@/types`)
- Avoid relative paths like `../../../` — always use `@/`

**Example import order:**
```typescript
import { useChat } from "@ai-sdk/react";
import { streamText, type UIMessage } from "ai";
import { geminiFlash } from "@/lib/openrouter";
import { tools, type ChatMessage } from "@/lib/tools";
import { PaymentCard } from "@/components/payment/payment-card";
import type { SessionData } from "@/types";
```

## Error Handling

**Patterns:**
- Try-catch blocks with specific error logging (e.g., `console.error("[upload] vercel blob put failed:", err)`)
- Error tags in logs: bracket-prefixed context (e.g., `[checkout]`, `[upload]`, `[stripe]`)
- Validation errors returned as structured response objects with `valid` boolean and `errors` array
- API errors: Return `NextResponse.json({ error: "message" }, { status: 400|500 })`
- Graceful degradation: Missing environment variables throw with descriptive messages (e.g., `throw new Error("STRIPE_SECRET_KEY is not configured")`)
- Tool errors: Return structured result with `valid: false` and `errors: string[]` array

**Example validation pattern:**
```typescript
const errors: string[] = [];
if (!name.trim() || name.trim().length < 2) {
  errors.push("Please provide your full name.");
}
if (errors.length > 0) {
  return { valid: false, errors };
}
return { valid: true, details: { name: name.trim(), ... } };
```

## Logging

**Framework:** `console` (native)

**Patterns:**
- Error logging: `console.error("[context] message", error)`
- Info/debug: Not observed in codebase (minimal logging)
- Error context tags: Square-bracket prefix matching the feature (e.g., `[checkout]`, `[upload]`, `[kv]`)
- Log when: Operations that can fail (external API calls, file uploads, database operations)
- Don't log: Happy paths, routine state updates

## Comments

**When to Comment:**
- Complex algorithms or non-obvious logic (e.g., regex patterns with explanation)
- Business rules that aren't self-evident (e.g., line item naming for reconciliation)
- Workarounds or important constraints (e.g., "text-base (16px) is the strict minimum to prevent iOS auto-zoom")
- Inline comments for accessibility or compliance concerns (e.g., "h-11 w-11 = 44px — meets WCAG 2.5.5 AAA minimum touch target")

**JSDoc/TSDoc:**
- Minimal usage observed
- Tool definitions use `.description()` for Zod schema validation (e.g., `z.string().describe("Client's full name")`)
- Function parameter descriptions in tool definitions: Single-line strings via Zod describe
- No @param/@return JSDoc blocks found

**Comment examples from codebase:**
- `// `lineItem` is the firm-prescribed payment description ... for reconciliation`
- `// loadStripe must live outside the component so the Stripe object isn't recreated on every render`
- `// 1 hour` (inline for constant)
- `/* h-11 w-11 = 44px — meets WCAG 2.5.5 AAA minimum touch target */`
- `// Serialize visible text so streaming token updates also trigger scroll`

## Function Design

**Size:** Aim for single-responsibility functions
- Tool handlers: 20-60 lines (e.g., `collectDetails`, `uploadDocuments`)
- Component event handlers: 5-15 lines (e.g., `handleSend`, `handleKeyDown`)
- Async operations: 30-80 lines when including error handling (e.g., `createCheckoutSession`)

**Parameters:**
- Named parameters preferred over positional (destructure object parameters)
- Example: `async function createCheckoutSession(args: CreateCheckoutSessionArgs)` vs positional args
- Type the parameters with interfaces (e.g., `CreateCheckoutSessionArgs`, `MessageInputProps`)

**Return Values:**
- Validation functions: Return structured objects `{ valid: boolean, errors?: string[], details?: T }`
- Async operations: Return the created/updated resource or null on failure
- Tool results: Return object matching tool's `execute` function signature
- Component handlers: Return `void` for event handlers, `React.ReactNode` for renders

## Module Design

**Exports:**
- Named exports: Standard for utilities and components (e.g., `export function validateEmail()`, `export function ChatWidget()`)
- Default exports: Not used
- Type exports: Use `export type` for interfaces/types (e.g., `export type ChatMessage = ...`)
- Re-exports: Barrel file `src/lib/tools/index.ts` exports all tool definitions and types

**Barrel Files:**
- `src/lib/tools/index.ts`: Re-exports all tool definitions and inferred types
  ```typescript
  export const tools = { matchQuestion, collectDetails, ... };
  export type ChatTools = InferUITools<typeof tools>;
  export type ChatMessage = UIMessage<...>;
  ```
- Purpose: Single import point for all tools and chat-related types
- Use: `import { tools, type ChatMessage } from "@/lib/tools"`

**Module organization:**
- Single responsibility per file (e.g., each tool in its own file)
- Related utilities grouped in directories (e.g., `src/lib/tools/`, `src/components/chat/`)
- Shared types in `src/types/index.ts`
- Constants co-located with usage when specific, global in `lib` when shared

## Tailwind & Styling

**Class usage:** Tailwind CSS v4 utility classes inline
- Color reference: `bg-brand` maps to brand color (#61BBCA)
- Layout: Flexbox utilities (e.g., `flex`, `items-center`, `gap-2`)
- Spacing: Tailwind scale (e.g., `p-3`, `px-4`, `py-2.5`)
- Responsive: Not observed in current codebase
- Accessibility: ARIA labels and live regions (e.g., `aria-label`, `aria-hidden`, `role="alert"`)

**Example:**
```tsx
className="flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-base focus:border-[#085a66] focus:outline-none focus:ring-2 focus:ring-[#085a66]"
```

## React/TypeScript Patterns

**Hooks:**
- `useState`: For local component state
- `useRef`: For DOM references
- `useEffect`: For side effects and scroll behavior
- `useCallback`: To memoize functions passed as callbacks
- `useMemo`: To memoize computed values (e.g., transport instance)
- `useChat` from `@ai-sdk/react`: For AI chat integration

**Component Structure:**
- Use client directive: `"use client"` at top of interactive components
- Functional components only (no classes)
- Props destructured with interface typing
- Event handlers prefixed with `handle` (e.g., `handleSend`, `handleKeyDown`)

**AI SDK Integration:**
- Tools use `tool()` factory from `ai` package
- Input validation via Zod schemas with `.describe()` for documentation
- Server-side tools: Include `execute` async function
- Client-side tool rendering: No `execute` function, return UI directly
- Chat state: `useChat` hook from `@ai-sdk/react` with custom `ChatMessage` type

---

*Convention analysis: 2026-04-23*
