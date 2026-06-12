import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/kv", () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

import { normalizeLeadSourceUrl } from "@/lib/lead-source";

describe("normalizeLeadSourceUrl", () => {
  it("keeps ordinary http and https URLs with query params", () => {
    expect(
      normalizeLeadSourceUrl(
        " https://microsite.example/bail-help?utm_campaign=winter "
      )
    ).toBe("https://microsite.example/bail-help?utm_campaign=winter");
  });

  it("strips credentials and fragments before storage", () => {
    expect(
      normalizeLeadSourceUrl(
        "https://user:pass@microsite.example/bail-help?utm_source=ad#pricing"
      )
    ).toBe("https://microsite.example/bail-help?utm_source=ad");
  });

  it("rejects unsupported protocols and malformed input", () => {
    expect(normalizeLeadSourceUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeLeadSourceUrl("not a url")).toBeNull();
    expect(normalizeLeadSourceUrl(null)).toBeNull();
  });
});
