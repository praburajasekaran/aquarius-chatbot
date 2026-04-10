import type { InferUITools, ToolSet, UIDataTypes, UIMessage } from "ai";
import { matchQuestion } from "./match-question";
import { collectDetails } from "./collect-details";
import { selectUrgency } from "./select-urgency";
import { initiatePayment } from "./initiate-payment";
import { showOptions } from "./show-options";

export const tools = {
  matchQuestion,
  collectDetails,
  selectUrgency,
  initiatePayment,
  showOptions,
} satisfies ToolSet;

export type ChatTools = InferUITools<typeof tools>;
export type ChatMessage = UIMessage<never, UIDataTypes, ChatTools>;
