import { describe, it, expect } from "vitest";
import { snippetMatter } from "../format-matter";

describe("snippetMatter — Decision 4 (04-CONTEXT.md)", () => {
  it("returns empty string for empty input", () => {
    expect(snippetMatter("")).toBe("");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(snippetMatter("   \n\t  ")).toBe("");
  });

  it("returns first sentence without trailing period", () => {
    expect(
      snippetMatter("First sentence here. Second sentence follows.")
    ).toBe("First sentence here");
  });

  it("treats '?' as sentence terminator", () => {
    expect(snippetMatter("Is this thing on? Yes it is.")).toBe(
      "Is this thing on"
    );
  });

  it("treats '!' as sentence terminator", () => {
    expect(snippetMatter("Help me! Urgent matter follows.")).toBe("Help me");
  });

  it("collapses multi-line input", () => {
    expect(snippetMatter("Line one.\nLine two follows.")).toBe("Line one");
  });

  it("returns input verbatim when 120 chars and no punctuation", () => {
    const input = "a".repeat(120);
    expect(snippetMatter(input)).toBe(input);
    expect(snippetMatter(input).length).toBe(120);
  });

  it("truncates input over 120 chars with ellipsis (no punctuation)", () => {
    const input = "a".repeat(200);
    const result = snippetMatter(input);
    expect(result.endsWith("...")).toBe(true);
    expect(result.length).toBe(120);
    expect(result.slice(0, 117)).toBe("a".repeat(117));
  });

  it("truncates first-sentence over 120 chars with ellipsis", () => {
    const input = "x".repeat(200) + ". next sentence.";
    const result = snippetMatter(input);
    expect(result.endsWith("...")).toBe(true);
    expect(result.length).toBe(120);
  });

  it("collapses whitespace runs", () => {
    expect(snippetMatter("Hello    world. Bye.")).toBe("Hello world");
  });

  it("handles input with no terminating punctuation under 120", () => {
    expect(snippetMatter("Short note about a matter")).toBe(
      "Short note about a matter"
    );
  });

  it("handles 121-char no-punctuation input — truncates to exactly 120", () => {
    const input = "b".repeat(121);
    const result = snippetMatter(input);
    expect(result.length).toBe(120);
    expect(result.endsWith("...")).toBe(true);
    expect(result.slice(0, 117)).toBe("b".repeat(117));
  });

  it("normalises \\r\\n line endings to single space", () => {
    expect(snippetMatter("Line one\r\nLine two")).toBe("Line one Line two");
  });
});
