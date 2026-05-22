import { getIntake } from "@/lib/intake";
import { handleIntakePaid } from "@/lib/intake/handle-paid";

export interface HandleConfirmedPaymentArgs {
  sessionId: string;
  bpointTxnNumber: string;
  amountCents: number;
}

/**
 * Shared BPoint post-payment fan-out adapter. Imported by:
 *   - GET /api/checkout/confirm  (Phase 2)
 *   - POST /api/webhooks/bpoint   (Phase 3)
 *
 * Caller MUST wrap in try/catch. This thin wrapper preserves the BPoint-facing
 * API while routing through the current provider-neutral intake fan-out.
 */
export async function handleConfirmedPayment(
  args: HandleConfirmedPaymentArgs
): Promise<void> {
  const { sessionId, bpointTxnNumber, amountCents } = args;

  const intake = await getIntake(sessionId);
  if (!intake) {
    throw new Error(
      `[payments] no intake for sessionId=${sessionId} (txn=${bpointTxnNumber})`
    );
  }

  await handleIntakePaid({
    sessionId,
    paymentRef: bpointTxnNumber,
    paymentAmount: amountCents,
    clientEmail: intake.clientEmail,
    clientName: intake.clientName,
    source: "bpoint",
  });
}
