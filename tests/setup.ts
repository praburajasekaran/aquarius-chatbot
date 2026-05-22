import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom does not implement Element.prototype.scrollIntoView. Polyfill as no-op
// so that components which call scrollIntoView in useEffect can mount in tests.
if (typeof window !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}

// Vitest runs with `globals: false`, so RTL does not auto-cleanup between
// tests. Explicitly unmount rendered components after each test so DOM queries
// don't accidentally match leftover elements from previous tests.
afterEach(() => {
  cleanup();
});
