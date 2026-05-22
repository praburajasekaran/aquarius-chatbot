import { defineConfig } from "vitest/config";
import path from "path";

const runUat = process.env.UAT_SMOKE === "1";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    unstubGlobals: true,
    clearMocks: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    exclude: runUat
      ? ["**/node_modules/**", "**/dist/**", "**/.claude/**", "**/.commandcode/**"]
      : [
          "**/node_modules/**",
          "**/dist/**",
          "**/.claude/**",
          "**/.commandcode/**",
          "tests/uat/**",
        ],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
