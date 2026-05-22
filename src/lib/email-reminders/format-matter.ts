/**
 * Format a matter description for inline rendering in re-engagement emails.
 * Implements 04-CONTEXT.md Decision 4: first sentence (split on [.!?] + whitespace),
 * or first 120 chars + ellipsis if no sentence-ending punctuation. Newlines
 * collapsed to spaces; whitespace runs normalised; never throws.
 *
 * Used by: src/lib/email/templates/reengagement-payment.tsx (1h and 24h variants).
 *
 * Pure function — no imports, no side effects, no console output.
 */

const MAX_SNIPPET_LENGTH = 120;
const TRUNCATE_AT = 117; // 120 - "...".length

export function snippetMatter(matterDescription: string): string {
  if (!matterDescription) return "";

  // Normalise whitespace: collapse \n, \r, runs of spaces.
  const normalised = matterDescription
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (normalised.length === 0) return "";

  // Split on sentence-ending punctuation followed by whitespace.
  // The split keeps the first segment without the trailing [.!?].
  const parts = normalised.split(/[.!?]\s/);
  const firstSentence = parts[0] ?? normalised;

  if (firstSentence.length <= MAX_SNIPPET_LENGTH) return firstSentence;
  return firstSentence.slice(0, TRUNCATE_AT) + "...";
}
