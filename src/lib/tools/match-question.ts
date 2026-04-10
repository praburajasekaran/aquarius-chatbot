import { tool } from "ai";
import { z } from "zod";
import type { QAPair } from "@/types";
import qaData from "@/lib/knowledge-base/criminal-law.json";

const knowledgeBase: QAPair[] = qaData;

function findBestMatch(query: string): QAPair | null {
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/);

  let bestMatch: QAPair | null = null;
  let bestScore = 0;

  for (const qa of knowledgeBase) {
    let score = 0;

    // Check keyword matches
    for (const keyword of qa.keywords) {
      if (queryLower.includes(keyword.toLowerCase())) {
        score += 3;
      }
    }

    // Check word overlap with the question
    const questionWords = qa.question.toLowerCase().split(/\s+/);
    for (const word of queryWords) {
      if (word.length > 3 && questionWords.some((qw) => qw.includes(word))) {
        score += 1;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = qa;
    }
  }

  // Require a minimum score to consider it a match
  return bestScore >= 3 ? bestMatch : null;
}

export const matchQuestion = tool({
  description:
    "Match a visitor's question to the approved criminal law Q&A knowledge base. Use this tool whenever a visitor asks a question about criminal law.",
  inputSchema: z.object({
    question: z.string().describe("The visitor's question"),
  }),
  execute: async ({ question }) => {
    const match = findBestMatch(question);

    if (match) {
      return {
        matched: true,
        questionId: match.id,
        originalQuestion: match.question,
        answer: match.answer,
      };
    }

    return {
      matched: false,
      fallback: true,
    };
  },
});
