import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/tools";
import { resolvePaymentAndMaybeAppendUpload } from "./post-payment-upload-adapter";

describe("resolvePaymentAndMaybeAppendUpload", () => {
  it("resolves completed payment and appends the document upload tool", () => {
    const messages = [
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-initiatePayment",
            state: "input-available",
            toolCallId: "payment_1",
            input: { sessionId: "s_test" },
          },
        ],
      },
    ] as unknown as ChatMessage[];

    expect(
      resolvePaymentAndMaybeAppendUpload(
        messages,
        "payment_1",
        "s_test",
        "completed",
        "fixed"
      )
    ).toEqual([
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-initiatePayment",
            state: "output-available",
            toolCallId: "payment_1",
            input: { sessionId: "s_test" },
            output: { status: "completed" },
          },
        ],
      },
      {
        id: "post_payment_upload_fixed",
        role: "assistant",
        parts: [
          {
            type: "tool-uploadDocuments",
            state: "input-available",
            toolCallId: "post_payment_upload_fixed",
            input: { sessionId: "s_test" },
          },
        ],
      },
    ]);
  });

  it("does not append upload on failed payment", () => {
    const messages = [
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-initiatePayment",
            state: "input-available",
            toolCallId: "payment_1",
            input: { sessionId: "s_test" },
          },
        ],
      },
    ] as unknown as ChatMessage[];

    const resolved = resolvePaymentAndMaybeAppendUpload(
      messages,
      "payment_1",
      "s_test",
      "failed",
      "fixed"
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0].parts[0]).toMatchObject({
      state: "output-available",
      output: { status: "failed" },
    });
  });

  it("does not append a duplicate upload tool", () => {
    const messages = [
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-initiatePayment",
            state: "output-available",
            toolCallId: "payment_1",
            input: { sessionId: "s_test" },
            output: { status: "completed" },
          },
        ],
      },
      {
        id: "upload_existing",
        role: "assistant",
        parts: [
          {
            type: "tool-uploadDocuments",
            state: "input-available",
            toolCallId: "upload_existing",
            input: { sessionId: "s_test" },
          },
        ],
      },
    ] as unknown as ChatMessage[];

    expect(
      resolvePaymentAndMaybeAppendUpload(
        messages,
        "payment_1",
        "s_test",
        "completed",
        "fixed"
      )
    ).toHaveLength(2);
  });

  it("uses the payment tool session when the current chat session changed after redirect", () => {
    const messages = [
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-initiatePayment",
            state: "input-available",
            toolCallId: "payment_1",
            input: { sessionId: "s_paid" },
          },
        ],
      },
    ] as unknown as ChatMessage[];

    const resolved = resolvePaymentAndMaybeAppendUpload(
      messages,
      "payment_1",
      "s_fresh_after_redirect",
      "completed",
      "fixed"
    );

    expect(resolved[1].parts[0]).toMatchObject({
      type: "tool-uploadDocuments",
      input: { sessionId: "s_paid" },
    });
  });
});
