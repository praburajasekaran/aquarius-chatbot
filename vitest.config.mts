import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

// Two-layer UAT gate: exclude keeps tests/uat/** out of default `npm test`;
// per-test `describe.skipIf(!UAT_SMOKE)` in each UAT file is the second defense.
// Never wire CI with `UAT_SMOKE=1` — risks BPoint rate limits on firm's facility
// (04-CONTEXT.md).
const runUat = process.env.UAT_SMOKE === "1";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "node",
    environmentMatchGlobs: [
      ["tests/**/*.test.tsx", "jsdom"],
      ["tests/payment-card.test.tsx", "jsdom"],
    ],
    setupFiles: ["./tests/setup.ts"],
    globals: false,
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: runUat
      ? ["node_modules/**", "dist/**"]
      : ["node_modules/**", "dist/**", "tests/uat/**"],
  },
});
