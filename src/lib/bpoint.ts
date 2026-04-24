import { PRICING, type CheckoutUrgency } from "@/lib/pricing";

interface BpointConfig {
  username: string;
  password: string;
  merchantNumber: string;
  baseUrl: string;
  isTestTxn: boolean;
}

// Evaluated per-call (NOT cached at module load) so BPOINT_ENV changes
// take effect on the next request without a cold-start. See
// .planning/phases/01-foundation/01-RESEARCH.md Pitfall 3.
function getBpointConfig(): BpointConfig {
  const username = process.env.BPOINT_API_USERNAME;
  const password = process.env.BPOINT_API_PASSWORD;
  const merchantNumber = process.env.BPOINT_MERCHANT_NUMBER;
  if (!username) throw new Error("BPOINT_API_USERNAME is not configured");
  if (!password) throw new Error("BPOINT_API_PASSWORD is not configured");
  if (!merchantNumber) {
    throw new Error("BPOINT_MERCHANT_NUMBER is not configured");
  }

  const isProd = process.env.BPOINT_ENV === "prod";
  return {
    username,
    password,
    merchantNumber,
    // Aquarius's BPoint facility is production-only; the separate UAT facility
    // on bpoint.uat.linkly.com.au doesn't know this merchant. Sandbox/dev mode
    // is signalled via IsTestTxn, not via hostname.
    baseUrl: "https://www.bpoint.com.au/webapi/v2",
    isTestTxn: !isProd,
  };
}

function buildBpointAuthHeader(
  username: string,
  merchantNumber: string,
  password: string
): string {
  // BPoint v2: Authorization header uses standard "Basic <b64>" format, but
  // the composite credential is non-standard: `username|merchantNumber:password`.
  const raw = `${username}|${merchantNumber}:${password}`;
  return "Basic " + Buffer.from(raw).toString("base64");
}

export interface CreateAuthKeyArgs {
  sessionId: string;
  urgency: CheckoutUrgency;
  redirectionUrlBase: string;
}

export async function createAuthKey(
  args: CreateAuthKeyArgs
): Promise<string> {
  const cfg = getBpointConfig();
  const pricing = PRICING[args.urgency];

  if (!Number.isInteger(pricing.amount) || pricing.amount < 100) {
    throw new Error(`[bpoint] invalid amount: ${pricing.amount}`);
  }

  const authHeader = buildBpointAuthHeader(
    cfg.username,
    cfg.merchantNumber,
    cfg.password
  );

  const res = await fetch(`${cfg.baseUrl}/txns/processtxnauthkey`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify({
      ProcessTxnData: {
        Action: "payment",
        Amount: pricing.amount,
        Crn1: args.sessionId,
        CurrencyCode: "AUD",
        MerchantReference: pricing.lineItem,
        RedirectionUrl: `${args.redirectionUrlBase}/api/checkout/confirm`,
        IsTestTxn: cfg.isTestTxn,
        ExpiryInMinutes: 30,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[bpoint] AuthKey creation failed", res.status, body);
    throw new Error(`BPoint AuthKey creation failed: ${res.status}`);
  }

  // BPoint v2 always returns HTTP 200 — success vs failure is signalled by
  // APIResponse.ResponseCode (0 = success, non-zero = error with ResponseText).
  const data = (await res.json()) as {
    AuthKey: string | null;
    APIResponse: { ResponseCode: number; ResponseText: string };
  };
  if (data.APIResponse.ResponseCode !== 0 || !data.AuthKey) {
    console.error(
      "[bpoint] AuthKey creation rejected",
      data.APIResponse.ResponseCode,
      data.APIResponse.ResponseText
    );
    throw new Error(
      `BPoint AuthKey rejected: ${data.APIResponse.ResponseText} (code ${data.APIResponse.ResponseCode})`
    );
  }
  return data.AuthKey;
}
