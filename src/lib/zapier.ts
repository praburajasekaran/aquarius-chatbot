export async function sendToZapier(payload: Record<string, unknown>) {
  const url = process.env.ZAPIER_WEBHOOK_URL;
  if (!url) throw new Error("ZAPIER_WEBHOOK_URL not configured");

  const attempt = async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Zapier webhook failed: ${res.status}`);
    return res;
  };

  try {
    return await attempt();
  } catch {
    // Retry once on failure
    return await attempt();
  }
}
