import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

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
  },
});
