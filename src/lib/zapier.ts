export async function sendToZapier(
  url: string,
  payload: Record<string, unknown>
) {
  if (!url) throw new Error("Zapier webhook URL not configured");

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
    return await attempt();
  }
}
