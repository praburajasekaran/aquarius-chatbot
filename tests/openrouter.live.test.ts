import { expect, it, vi } from "vitest";
import { generateText, stepCountIs, type ModelMessage } from "ai";
import { chatModel } from "@/lib/openrouter";
import { systemPrompt } from "@/lib/system-prompt";
import { tools } from "@/lib/tools";
import { PRICING } from "@/lib/pricing";

it.skipIf(process.env.LIVE_MODEL_SMOKE !== "1")(
  "answers from the knowledge base and requests intake, payment, and upload using the live model",
  async () => {
    const sessionId = "s_live_model_smoke";
    const selectUrgency = vi.fn(async ({ urgency }: { urgency: "urgent" | "non-urgent" }) => ({
      urgency,
      amount: PRICING[urgency].amount,
      displayPrice: PRICING[urgency].displayPrice,
      costDisclosure: `The total cost is ${PRICING[urgency].displayPrice}.`,
    }));
    // The real urgency tool sends emails and schedules jobs. This test only
    // checks the model's decisions, so those external writes stay disabled.
    const smokeTools = {
      ...tools,
      selectUrgency: { ...tools.selectUrgency, execute: selectUrgency },
    };
    const messages: ModelMessage[] = [];
    async function turn(text?: string) {
      if (text) messages.push({ role: "user", content: text });
      const result = await generateText({
        model: chatModel,
        system: `${systemPrompt}\nThe sessionId for this conversation is "${sessionId}". Use exactly this sessionId in tool calls.`,
        messages,
        tools: smokeTools,
        stopWhen: [stepCountIs(4), ({ steps }) => {
          const calls = steps.at(-1)?.toolCalls ?? [];
          return calls.length > 0 && (
            calls.every((call) => call.toolName === "showOptions") ||
            calls.some((call) => !smokeTools[call.toolName as keyof typeof smokeTools]?.execute)
          );
        }],
        maxRetries: 0,
      });
      messages.push(...result.response.messages);
      return result;
    }

    const question = await turn("Can I get bail?");
    expect(question.steps.flatMap((step) => step.toolResults)).toContainEqual(
      expect.objectContaining({ toolName: "matchQuestion", output: expect.objectContaining({ matched: true }) }),
    );
    expect(question.text.trim().length).toBeGreaterThan(0);

    const details = await turn("I'd like to book a Legal Strategy Session for a bail matter. My name is Test Visitor, email test@example.invalid, and Australian phone 0412345678.");
    expect(details.steps.flatMap((step) => step.toolResults)).toContainEqual(
      expect.objectContaining({ toolName: "collectDetails", output: expect.objectContaining({ valid: true }) }),
    );
    expect(selectUrgency).not.toHaveBeenCalled();

    const urgency = await turn("Non-urgent — $726 (GST inc.)");
    expect(selectUrgency).toHaveBeenCalledOnce();
    expect(selectUrgency.mock.calls[0][0]).toMatchObject({ sessionId, urgency: "non-urgent" });
    expect(urgency.steps.flatMap((step) => step.toolCalls)).toContainEqual(
      expect.objectContaining({ toolName: "showOptions", input: expect.objectContaining({ mandatory: true }) }),
    );

    const payment = await turn("Yes, please proceed");
    const paymentCall = payment.toolCalls.find((call) => call.toolName === "initiatePayment");
    expect(paymentCall).toMatchObject({ input: { sessionId } });
    if (!paymentCall) throw new Error("The model did not request checkout");
    messages.push({ role: "tool", content: [{
      type: "tool-result", toolCallId: paymentCall.toolCallId, toolName: "initiatePayment",
      output: { type: "json", value: { status: "completed" } },
    }] });
    const upload = await turn();
    const uploadCall = upload.toolCalls.find((call) => call.toolName === "uploadDocuments");
    expect(uploadCall).toMatchObject({ input: expect.objectContaining({ sessionId }) });
    expect([...payment.toolCalls, ...upload.toolCalls].some(
      (call) => call.toolName === "scheduleAppointment" || call.toolName === "showUrgentContact",
    )).toBe(false);
  },
  120_000,
);
