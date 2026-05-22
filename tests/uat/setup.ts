// Shared helpers for tests/uat/*.test.ts. Every UAT test file imports these.
// See .planning/phases/04-validation/04-RESEARCH.md §"Pattern 1" + Pitfall 7.

export function assertUatGate(): void {
  if (process.env.UAT_SMOKE !== "1") {
    throw new Error("[uat-guard] UAT_SMOKE must be set to '1' to run tests/uat/*");
  }
}

export function assertPreviewUrl(): string {
  const url = process.env.UAT_PREVIEW_URL ?? "";
  if (!url.includes(".vercel.app")) {
    throw new Error(
      `[uat-guard] UAT_PREVIEW_URL must be a Vercel preview URL (contain '.vercel.app'). got: ${url}`
    );
  }
  return url;
}

export function loadPreviewEnv(): {
  previewUrl: string;
  resultKey: string;
  bpointEnv: string;
} {
  const previewUrl = assertPreviewUrl();
  const resultKey = process.env.UAT_RESULT_KEY;
  if (!resultKey) {
    throw new Error(
      "[uat-guard] UAT_RESULT_KEY not set — capture ResultKey from a recent happy-path run (Vercel log, tag [bpoint-confirm])"
    );
  }
  const bpointEnv = process.env.BPOINT_ENV;
  if (bpointEnv !== "uat") {
    throw new Error(
      `[uat-guard] BPOINT_ENV must be 'uat' for UAT smoke (got: ${bpointEnv})`
    );
  }
  return { previewUrl, resultKey, bpointEnv };
}
