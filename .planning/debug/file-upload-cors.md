---
status: resolved
trigger: "Late upload page silently fails while browser logs CORS errors for https://vercel.com/api/blob/?pathname=5-ways.pdf from https://aquarius-chatbot-nine.vercel.app/upload/session"
created: "2026-05-30"
updated: "2026-05-30"
---

# Debug Session: file-upload-cors

## Symptoms

- Expected behavior: File should upload with upload status always visible.
- Actual behavior: Upload fails silently; UI remains in progress.
- Error messages: Browser blocks fetch to `https://vercel.com/api/blob/?pathname=5-ways.pdf` because the response has no `Access-Control-Allow-Origin` header.
- Timeline: Started failing only in the last couple of instances.
- Reproduction: Open the upload session URL, select a PDF, submit documents.

## Current Focus

- hypothesis: The late-upload page relies on `@vercel/blob/client.upload()`, which sends the browser to Vercel's Blob API; recent failures occur outside our origin and surface as CORS-blocked network errors.
- test: Replace the late-upload browser direct-upload flow with an authenticated same-origin multipart POST handled by the existing Next route.
- expecting: The browser only fetches `/upload/api/late-upload/session`, upload errors become JSON/UI errors, and completion delivery still runs through `handleUploadCompleted`.
- next_action: Deploy the same-origin upload path and confirm production upload succeeds.

## Evidence

- timestamp: 2026-05-30
  observation: `LateUploadClient` imports `upload` from `@vercel/blob/client` and calls it with `handleUploadUrl: "/upload/api/late-upload/session"`.
- timestamp: 2026-05-30
  observation: The console error is on `https://vercel.com/api/blob/?pathname=5-ways.pdf`, not the same-origin handler route.
- timestamp: 2026-05-30
  observation: Targeted tests for the late-upload client and route pass after replacing the browser direct-upload path.

## Eliminated

## Resolution

- root_cause: The late-upload page used the Vercel Blob browser client, so the browser directly contacted Vercel's Blob API and could fail behind a CORS-blocked vendor response before our UI got a useful same-origin error.
- fix: Changed the late-upload page to POST multipart form data to `/upload/api/late-upload/session`; the route now validates the upload, stores it server-side with `@vercel/blob.put()`, and calls the existing completion pipeline.
- verification: `npm run test -- tests/late-upload-client.test.tsx tests/late-upload-route.test.ts` passes. `npx tsc --noEmit` is only blocked by pre-existing `tests/upload-token-route.test.ts` `Request` vs `NextRequest` type errors.
- files_changed: `src/components/upload/late-upload-client.tsx`, `src/app/api/late-upload/session/route.ts`, `tests/late-upload-client.test.tsx`, `tests/late-upload-route.test.ts`
