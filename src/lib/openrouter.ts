import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

export const chatModel = openrouter("openai/gpt-5-mini", {
  provider: {
    only: ["azure"],
    zdr: true,
    data_collection: "deny",
  },
});
