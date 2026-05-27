import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/webhooks/smokeball-matter-created/route";

function request(body: unknown) {
  return new Request("https://app.test/api/webhooks/smokeball-matter-created", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-smokeball-capture-secret": "capture-secret",
    },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

describe("Smokeball matter capture webhook", () => {
  it("rejects null-like matter IDs before storing the mapping", async () => {
    process.env.SMOKEBALL_CAPTURE_SECRET = "capture-secret";

    const res = await POST(
      request({
        sessionId: "sess-1",
        smokeballMatterId: "null",
      })
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "invalid_payload",
    });
  });
});
