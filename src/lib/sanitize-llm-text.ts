// DeepSeek (and other LLMs reached via OpenRouter) occasionally leak raw
// tokenizer control markers — `<|begin_of_sentence|>`, `<|im_start|>`,
// `<|end_of_sentence|>`, sometimes with double underscores or stray
// whitespace, plus safety wrappers like `<ds_safety>...</ds_safety>` — into
// the assistant text that streams to the client. The system prompt forbids
// these but the model ignores it intermittently, especially in the post-
// upload window where it has been observed mid-stream switching languages
// and producing gibberish (see screenshot: "<|begin__of__sentence|>La
// ragazza di nome Sophia..."). Strip them defensively so they never reach
// the visitor and so they're not echoed back to the model on the next turn.

// Match `<|...|>` with optional whitespace around the pipes/content.
// Non-greedy so adjacent tokens don't get coalesced into one match.
const CONTROL_TOKEN = /<\s*\|\s*[^>|]*?\s*\|\s*>/g;

// Safety / reasoning wrappers the system prompt explicitly bans.
const SAFETY_TAG = /<\/?(?:ds_safety|aq_labs|reasoning|thinking)\b[^>]*>/gi;

export function sanitizeAssistantText(input: string): string {
  if (!input) return input;
  let out = input.replace(CONTROL_TOKEN, "");
  out = out.replace(SAFETY_TAG, "");
  // Collapse the run of blank lines a stripped tag may leave behind, but
  // keep single newlines intact so paragraph structure survives.
  out = out.replace(/\n{3,}/g, "\n\n");
  return out;
}
