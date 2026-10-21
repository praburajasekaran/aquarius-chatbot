import { afterEach, expect, it, vi } from "vitest";
import { generateText, stepCountIs } from "ai";
import { matchQuestion } from "@/lib/tools/match-question";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("routes tool calls through Azure with zero retention and no data collection", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  const requests: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    const first = requests.length === 1;
    return Response.json({
      id: `completion-${requests.length}`,
      object: "chat.completion",
      created: 1,
      model: "openai/gpt-5-mini",
      choices: [{
        index: 0,
        finish_reason: first ? "tool_calls" : "stop",
        message: first ? {
          role: "assistant", content: null,
          tool_calls: [{ id: "call-bail", type: "function", function: {
            name: "matchQuestion", arguments: JSON.stringify({ question: "Can I get bail?" }),
          } }],
        } : { role: "assistant", content: "The approved bail answer is available." },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    });
  }));
  const { chatModel } = await import("@/lib/openrouter");
  const result = await generateText({
    model: chatModel,
    prompt: "Can I get bail?",
    tools: { matchQuestion },
    stopWhen: stepCountIs(2),
    maxRetries: 0,
  });

  expect(result.text).toBe("The approved bail answer is available.");
  expect(result.steps[0].toolResults[0]).toMatchObject({
    toolName: "matchQuestion", output: { matched: true },
  });
  expect(requests).toHaveLength(2);
  for (const request of requests) {
    expect(request).toMatchObject({
      model: "openai/gpt-5-mini",
      provider: { only: ["azure"], zdr: true, data_collection: "deny" },
    });
  }
});
