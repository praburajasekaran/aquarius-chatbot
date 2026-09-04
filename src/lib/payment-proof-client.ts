export async function verifyPaymentProof(
  proof: string,
  sessionId: string,
): Promise<boolean> {
  if (!proof || !sessionId) return false;
  try {
    const params = new URLSearchParams({ proof, sessionId });
    const response = await fetch(`/api/checkout/confirm/verify?${params}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { confirmed?: unknown };
    return body.confirmed === true;
  } catch {
    return false;
  }
}
