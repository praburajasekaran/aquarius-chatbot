import { describe, expect, it } from "vitest";
import {
  isAllowedContentType,
  normalizeContentType,
  resolveUploadContentType,
} from "@/lib/allowed-types";

describe("allowed content types", () => {
  it("accepts image/jpg and normalizes it to image/jpeg", () => {
    expect(isAllowedContentType("image/jpg")).toBe(true);
    expect(normalizeContentType("image/jpg")).toBe("image/jpeg");
  });

  it("infers jpg content type from the filename when the browser omits MIME", () => {
    expect(resolveUploadContentType("", "evidence.JPG")).toBe("image/jpeg");
  });

  it("infers HEIC/HEIF, DOC, RTF, and TXT content types from filenames", () => {
    expect(resolveUploadContentType("", "photo.heic")).toBe("image/heic");
    expect(resolveUploadContentType("", "scan.HEIF")).toBe("image/heif");
    expect(resolveUploadContentType("", "brief.doc")).toBe("application/msword");
    expect(resolveUploadContentType("", "notes.rtf")).toBe("application/rtf");
    expect(resolveUploadContentType("", "statement.txt")).toBe("text/plain");
  });

  it("normalizes text/plain charset parameters", () => {
    expect(resolveUploadContentType("text/plain; charset=utf-8", "statement.txt")).toBe(
      "text/plain"
    );
  });
});
