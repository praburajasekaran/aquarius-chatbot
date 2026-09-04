import { randomBytes } from "node:crypto";
import { redis } from "@/lib/kv";

const PAYMENT_PROOF_TTL_SECONDS = 10 * 60;
const PAYMENT_PROOF_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

type PaymentProofRecord = {
  sessionId: string;
};

export function paymentProofKey(proof: string, sessionId: string): string {
  return `bpoint-payment-proof:${encodeURIComponent(sessionId)}:${proof}`;
}

export async function issuePaymentProof(sessionId: string): Promise<string> {
  const proof = randomBytes(32).toString("base64url");
  const created = await redis.set(
    paymentProofKey(proof, sessionId),
    { sessionId } satisfies PaymentProofRecord,
    { nx: true, ex: PAYMENT_PROOF_TTL_SECONDS },
  );
  if (created !== "OK") {
    throw new Error("payment proof could not be stored");
  }
  return proof;
}

/**
 * Consume a proof only after matching it to the chatbot session. The session
 * is part of the Redis key, and GETDEL makes the redemption atomic so two
 * concurrent browser requests cannot both turn the same proof into a signal.
 * The parent/child once guards remain the final duplicate protection at the
 * browser boundary.
 */
export async function consumePaymentProof(
  proof: string,
  sessionId: string,
): Promise<boolean> {
  if (!PAYMENT_PROOF_PATTERN.test(proof) || !sessionId) return false;

  const record = await redis.getdel<PaymentProofRecord>(paymentProofKey(proof, sessionId));
  return record?.sessionId === sessionId;
}
