import type { ChatMessage } from "@/lib/tools";

function stamp() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function hasUploadAfterPayment(
  messages: ChatMessage[],
  paymentToolCallId: string
): boolean {
  let sawPayment = false;

  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      const maybeTool = part as { toolCallId?: string; type?: string };
      if (maybeTool.toolCallId === paymentToolCallId) {
        sawPayment = true;
        continue;
      }
      if (sawPayment && maybeTool.type === "tool-uploadDocuments") return true;
    }
  }

  return false;
}

export function resolvePaymentAndMaybeAppendUpload(
  messages: ChatMessage[],
  toolCallId: string,
  sessionId: string,
  status: "completed" | "failed",
  idSuffix: string = stamp()
): ChatMessage[] {
  const resolvedMessages = messages.map((message) => {
    if (message.role !== "assistant") return message;
    const parts = message.parts.map((part) => {
      const maybeTool = part as { toolCallId?: string };
      if (maybeTool.toolCallId !== toolCallId) return part;
      return {
        ...part,
        state: "output-available",
        output: { status },
      };
    });
    return { ...message, parts } as ChatMessage;
  });

  if (status !== "completed") return resolvedMessages;
  if (hasUploadAfterPayment(resolvedMessages, toolCallId)) return resolvedMessages;

  const id = `post_payment_upload_${idSuffix}`;
  return [
    ...resolvedMessages,
    {
      id,
      role: "assistant",
      parts: [
        {
          type: "tool-uploadDocuments",
          state: "input-available",
          toolCallId: id,
          input: {
            sessionId,
          },
        },
      ],
    } as unknown as ChatMessage,
  ];
}
