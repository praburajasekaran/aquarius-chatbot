/**
 * Revoke an active late-upload token for a given Stripe session.
 *
 * Usage:
 *   npx tsx src/scripts/revoke-upload-token.ts --session <bpointTxnNumber>
 */
import { redis } from "@/lib/kv";
import { revokeTokenByHash } from "@/lib/upload-tokens";

async function main() {
  const idx = process.argv.indexOf("--session");
  const sessionId = idx >= 0 ? process.argv[idx + 1] : undefined;
  if (!sessionId) {
    console.error("usage: --session <bpointTxnNumber>");
    process.exit(1);
  }

  const dedupeKey = `stripe-session:${sessionId}`;
  const tokenHash = await redis.get<string>(dedupeKey);
  if (!tokenHash || tokenHash === "pending") {
    console.error(`no active token for session ${sessionId}`);
    process.exit(2);
  }

  await revokeTokenByHash(tokenHash);
  await redis.del(dedupeKey);
  console.log(`revoked upload token for session ${sessionId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
