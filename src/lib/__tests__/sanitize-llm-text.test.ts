import { describe, it, expect } from "vitest";
import { sanitizeAssistantText } from "@/lib/sanitize-llm-text";

describe("sanitizeAssistantText", () => {
  it("strips DeepSeek begin/end-of-sentence markers (single underscore)", () => {
    expect(
      sanitizeAssistantText("<|begin_of_sentence|>Hello there<|end_of_sentence|>"),
    ).toBe("Hello there");
  });

  it("strips the double-underscore variant observed in the bug report", () => {
    expect(
      sanitizeAssistantText(
        "<|begin__of__sentence|>## Summary of the conversation",
      ),
    ).toBe("## Summary of the conversation");
  });

  it("strips control tokens with stray whitespace inside the pipes", () => {
    expect(
      sanitizeAssistantText("< | begin__of__sentence | >La ragazza"),
    ).toBe("La ragazza");
  });

  it("strips multiple tokens in one string", () => {
    expect(
      sanitizeAssistantText("<|im_start|>assistant<|im_end|>Reply<|eos|>"),
    ).toBe("assistantReply");
  });

  it("strips ds_safety wrappers", () => {
    expect(
      sanitizeAssistantText("<ds_safety>internal</ds_safety>Visible reply"),
    ).toBe("internalVisible reply");
  });

  it("collapses runs of blank lines a stripped tag leaves behind", () => {
    expect(
      sanitizeAssistantText("Line one\n\n\n\n<|eos|>\n\n\nLine two"),
    ).toBe("Line one\n\n\n\nLine two");
  });

  it("leaves clean text untouched", () => {
    expect(sanitizeAssistantText("Please proceed with payment.")).toBe(
      "Please proceed with payment.",
    );
  });

  it("handles empty input", () => {
    expect(sanitizeAssistantText("")).toBe("");
  });
});
