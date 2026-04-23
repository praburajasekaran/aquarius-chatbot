# Testing Patterns

**Analysis Date:** 2026-04-23

## Test Framework

**Status:** No testing framework detected

**Findings:**
- No Jest, Vitest, or other test runner in `package.json`
- No test files found (searched for `*.test.*` and `*.spec.*`)
- No test configuration files (`jest.config.*`, `vitest.config.*`)
- No testing libraries in dependencies (`@testing-library/react`, `vitest`, `jest`, etc.)

**Implication:** Tests are not currently implemented. When adding tests, recommend:
- **Runner:** Vitest (aligns with Next.js 16 + Vite ecosystem)
- **UI Testing:** `@testing-library/react` for component tests
- **HTTP Mocking:** `msw` (Mock Service Worker) for API endpoint testing
- **Type Safety:** Built-in with TypeScript support

## Untested Areas

**Critical functionality with no test coverage:**

### Chat/AI Integration
- File: `src/app/api/chat/route.ts`
- What's not tested:
  - Message streaming and model integration
  - Tool invocation and response handling
  - Stop condition enforcement (`stepCountIs(10)`)
  - Error propagation from AI SDK

### Tool Execution
- Files: `src/lib/tools/*.ts`
- What's not tested:
  - Input validation via Zod schemas
  - Error array generation in validation failures
  - State persistence after tool execution
  - Edge cases in each tool (collectDetails, uploadDocuments, etc.)

**Example untested flow (collectDetails tool):**
```typescript
export const collectDetails = tool({
  // Validation logic not tested:
  // - Name length validation
  // - Email format via validateEmail()
  // - Phone format via validatePhone()
  // - Matter description length requirement
  // - Error message generation
  execute: async ({ name, email, phone, matterDescription }) => {
    const errors: string[] = [];
    if (!name.trim() || name.trim().length < 2) {
      errors.push("Please provide your full name.");
    }
    // ... more validation
  },
});
```

### API Routes
- Files: `src/app/api/checkout/route.ts`, `src/app/api/upload/route.ts`, etc.
- What's not tested:
  - Request validation and error responses
  - Integration with external services (Stripe, Vercel Blob)
  - Session persistence via Redis
  - Response structure and status codes

**Example untested endpoint (checkout):**
```typescript
export async function POST(req: Request) {
  const { sessionId, urgency } = (await req.json()) as {...};
  if (!PRICING[urgency]) {
    return NextResponse.json({ error: "Invalid urgency" }, { status: 400 });
  }
  const checkoutSession = await createCheckoutSession({...});
  // No tests for: invalid urgency, missing sessionId, Stripe errors, Redis failures
}
```

### Validators
- File: `src/lib/validators.ts`
- What's not tested:
  - Email validation regex against various formats
  - Australian phone number regex with different patterns
  - File type validation against all ALLOWED_FILE_TYPES
  - File size validation boundary conditions (10MB limit)

**Example untested validator:**
```typescript
const AU_PHONE_REGEX = /^(?:\+?61|0)(?:4\d{8}|[2378]\d{8})$|^(?:04\d{2}\s?\d{3}\s?\d{3})$|^(?:0[2378]\s?\d{4}\s?\d{4})$/;

export function validatePhone(phone: string): boolean {
  const cleaned = phone.replace(/[\s\-()]/g, "");
  return AU_PHONE_REGEX.test(cleaned);
}
// No tests for: "+61412345678", "02 1234 5678", "0412345678", invalid formats, empty string
```

### Session Management (Redis)
- File: `src/lib/kv.ts`
- What's not tested:
  - Session creation with default values
  - Session retrieval and null handling
  - Session update with partial data
  - TTL enforcement (3600 seconds)
  - Session deletion

### Component Integration
- Files: `src/components/**/*.tsx`
- What's not tested:
  - User interactions (form submission, button clicks)
  - Component state changes
  - Prop handling and rendering
  - Accessibility attributes (aria-label, role)
  - Event handler invocation

**Example untested component (MessageInput):**
```typescript
export function MessageInput({ onSend, disabled }: MessageInputProps) {
  // Not tested:
  // - Text input and state updates
  // - Enter key submitting, Shift+Enter not submitting
  // - Focus management
  // - Disabled state rendering
  // - onSend callback invocation
}
```

## Test Coverage Strategy

**When tests are added, prioritize (in order):**

1. **Validators** (quick, high value)
   - All regex patterns in `src/lib/validators.ts`
   - Edge cases for each validation function
   - Integration tests with actual tool execution

2. **Tool Execution** (core flow)
   - Input validation for each tool's Zod schema
   - Error response generation
   - Success case execution
   - Mock external calls (e.g., email, file upload, session persistence)

3. **API Routes** (backend contracts)
   - Valid/invalid request handling
   - Status code verification
   - Response structure validation
   - Error scenarios (missing fields, invalid values)

4. **Session Management** (state integrity)
   - Redis operations (create, read, update, delete)
   - TTL behavior
   - Concurrent access patterns

5. **Components** (UI reliability)
   - Interaction tests for MessageInput, PaymentCard, DocumentUpload
   - State management in ChatWidget
   - Prop changes and re-renders
   - Accessibility compliance

6. **Chat Integration** (end-to-end)
   - Streaming responses from API
   - Tool invocation and callback handling
   - Error handling in chat flow

## Recommended Test Structure

When implementing tests, follow this organization:

```
src/
├── __tests__/
│   ├── validators.test.ts        # Unit tests for regex and validation
│   ├── lib/
│   │   ├── kv.test.ts            # Redis session management
│   │   └── tools/
│   │       ├── collect-details.test.ts
│   │       └── upload-documents.test.ts
│   ├── api/
│   │   ├── checkout.test.ts
│   │   └── upload.test.ts
│   └── components/
│       ├── chat/
│       │   ├── message-input.test.tsx
│       │   └── chat-widget.test.tsx
│       └── payment/
│           └── payment-card.test.tsx
```

Or co-located:

```
src/lib/
├── validators.ts
├── validators.test.ts
src/app/api/checkout/
├── route.ts
├── route.test.ts
src/components/chat/
├── message-input.tsx
├── message-input.test.tsx
```

## Mocking Strategy

**When tests are added:**

**API Mocking (MSW or similar):**
- Mock Stripe checkout session creation
- Mock Vercel Blob file uploads
- Mock Redis operations (or use test container)
- Mock OpenRouter/Gemini responses

**Example Stripe mock:**
```typescript
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue({
          id: "test-session-123",
          client_secret: "test-secret",
        }),
      },
    },
  }),
}));
```

**Component Mocking:**
- Mock child components when testing parents
- Mock AI SDK hooks (`useChat`)
- Mock callback props to verify invocation

**What to mock:**
- External service calls (Stripe, Redis, Vercel Blob, OpenRouter)
- HTTP requests (use MSW for API routes)
- Browser APIs if needed (localStorage, etc.)

**What NOT to mock:**
- Internal utilities (`validateEmail`, `normalizePhone`)
- Business logic (validation, transformation)
- React hooks (test their actual behavior)

## Configuration Recommendations

**Package.json additions when implementing:**
```json
{
  "devDependencies": {
    "vitest": "^1.0.0",
    "@testing-library/react": "^14.0.0",
    "@testing-library/jest-dom": "^6.0.0",
    "msw": "^2.0.0",
    "@vitest/ui": "^1.0.0"
  },
  "scripts": {
    "test": "vitest",
    "test:watch": "vitest --watch",
    "test:coverage": "vitest --coverage"
  }
}
```

**vitest.config.ts (recommended):**
```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

---

*Testing analysis: 2026-04-23*

**Status:** No tests currently implemented. Codebase is testable but lacks testing infrastructure. Recommend implementing tests starting with validators and tools, then API routes, then components.
