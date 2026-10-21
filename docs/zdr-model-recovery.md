# Restore chat replies with ZDR enforced

The previous `google/gemini-2.5-flash` model returned HTTP 404 under the account's Zero Data Retention policy. A live request on 21 October 2026 returned `No endpoints found matching your data policy (Zero data retention)`.

The chatbot now uses `openai/gpt-5-mini` through Azure. Each request includes `provider.only: ["azure"]`, `provider.zdr: true`, and `provider.data_collection: "deny"`. Provider routing cannot fall back to another provider or relax these privacy requirements.

GPT-4.1 Mini through Azure passed a basic reply check, but twice failed to call `matchQuestion` for `Can I get bail?` under the existing system prompt. GPT-5 Mini passed a live smoke test with the same prompt and actual tool definitions. The test covered the knowledge-base answer, contact validation, an explicit non-urgent choice, payment confirmation, checkout, and document upload. Payment completion was simulated. The urgency tool's email, intake, and reminder writes were replaced with a test result. No real payment, booking, email, or SMS was created.

The app presents booking after document upload through `resolvePostUploadBookingStep` and `postUploadBookingStepToChatMessage`. Automated tests verify that routing independently of the model.

`tests/openrouter.test.ts` checks the actual SDK request body and a knowledge-base tool round trip with a mocked HTTP response. `tests/openrouter.live.test.ts` is skipped by default. To run the live smoke test with an authorized OpenRouter key in `.env.local`, use:

```sh
LIVE_MODEL_SMOKE=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run tests/openrouter.live.test.ts --reporter=verbose
```

The live test makes paid model requests and sends synthetic contact details. It does not read visitor records. It must pass before a model replacement is released.
