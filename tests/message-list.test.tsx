// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MessageList } from "@/components/chat/message-list";
import type { ChatMessage } from "@/lib/tools";

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img {...props} />
  ),
}));

const noop = () => {};

function renderMessageList(
  messages: ChatMessage[],
  onMandatoryOptionPick = vi.fn(),
) {
  return {
    onMandatoryOptionPick,
    ...render(
      <MessageList
        messages={messages}
        sessionId="s_test"
        onPaymentComplete={noop}
        onPaymentFail={noop}
        onUploadComplete={noop}
        onUploadSkip={noop}
        onScheduleBooked={noop}
        onUrgentAcknowledged={noop}
        onMandatoryOptionPick={onMandatoryOptionPick}
      />,
    ),
  };
}

describe("MessageList mandatory payment options", () => {
  it("renders proceed buttons when the assistant asks the payment confirmation question without a showOptions tool part", async () => {
    const onMandatoryOptionPick = vi.fn();
    renderMessageList(
      [
        {
          id: "assistant-confirm",
          role: "assistant",
          parts: [
            {
              type: "text",
              text:
                "You've selected the Non-urgent Legal Strategy Session for $726.00 (incl. GST).\n\nDo you want to proceed with this booking?",
            },
          ],
        },
      ],
      onMandatoryOptionPick,
    );

    const proceed = screen.getByRole("button", {
      name: "Yes, please proceed",
    });
    expect(proceed).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "No, I don't want to proceed" }),
    ).toBeEnabled();

    await userEvent.click(proceed);
    expect(onMandatoryOptionPick).toHaveBeenCalledWith("Yes, please proceed");
  });
});
