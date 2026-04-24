import "@testing-library/jest-dom/vitest";

// jsdom does not implement Element.prototype.scrollIntoView. Polyfill as no-op
// so that components which call scrollIntoView in useEffect can mount in tests.
if (typeof window !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}
