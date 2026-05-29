import { describe, expect, it } from "vitest";
import { MAX_BYTES, formatUploadLimit } from "@/lib/allowed-types";
import { validateFileSize } from "@/lib/validators";

describe("file size validation", () => {
  it("accepts 20 MB and rejects anything larger", () => {
    expect(MAX_BYTES).toBe(20 * 1024 * 1024);
    expect(formatUploadLimit()).toBe("20 MB");
    expect(validateFileSize(MAX_BYTES)).toBe(true);
    expect(validateFileSize(MAX_BYTES + 1)).toBe(false);
  });
});
