import { PRICING, type CheckoutUrgency } from "@/lib/pricing";

interface BpointConfig {
  username: string;
  password: string;
  merchantNumber: string;
  billerCode?: string;
  baseUrl: string;
  isTestTxn: boolean;
}

function getBpointConfig(): BpointConfig {
  const username = process.env.BPOINT_API_USERNAME;
  const password = process.env.BPOINT_API_PASSWORD;
  const merchantNumber = process.env.BPOINT_MERCHANT_NUMBER;
  if (!username) throw new Error("BPOINT_API_USERNAME is not configured");
  if (!password) throw new Error("BPOINT_API_PASSWORD is not configured");
  if (!merchantNumber) throw new Error("BPOINT_MERCHANT_NUMBER is not configured");

  return {
    username,
    password,
    merchantNumber,
    billerCode: process.env.BPOINT_BILLER_CODE,
    baseUrl: "https://www.bpoint.com.au/webapi/v2",
    isTestTxn: process.env.BPOINT_ENV !== "prod",
  };
}

function buildBpointAuthHeader(cfg: BpointConfig): string {
  return "Basic " + Buffer.from(
    `${cfg.username}|${cfg.merchantNumber}:${cfg.password}`
  ).toString("base64");
}

export interface CreateAuthKeyArgs {
  sessionId: string;
  urgency: CheckoutUrgency;
  customerEmail?: string;
  redirectionUrlBase: string;
  browserReturnUrlBase?: string;
  webhookUrlBase?: string;
}

export function getBpointRedirectBaseUrl(): string {
  const raw =
    process.env.BPOINT_REDIRECT_BASE_URL ??
    process.env.NEXT_PUBLIC_URL ??
    process.env.APP_URL;
  if (!raw) {
    throw new Error("BPOINT_REDIRECT_BASE_URL or NEXT_PUBLIC_URL is required");
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("BPoint redirect base URL must be a valid absolute URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("BPoint redirect base URL must be HTTPS");
  }
  return url.origin;
}

function buildMerchantReference(sessionId: string): string {
  const safeSessionId = sessionId
    .replace(/[^A-Za-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `AQ-${safeSessionId}`.slice(0, 50);
}

export async function createAuthKey(args: CreateAuthKeyArgs): Promise<string> {
  const cfg = getBpointConfig();
  const pricing = PRICING[args.urgency];
  const redirectionUrl = new URL("/api/checkout/confirm", args.redirectionUrlBase);
  if (args.browserReturnUrlBase) {
    redirectionUrl.searchParams.set("returnTo", args.browserReturnUrlBase);
  }
  const res = await fetch(`${cfg.baseUrl}/txns/processtxnauthkey`, {
    method: "POST",
    headers: {
      Authorization: buildBpointAuthHeader(cfg),
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      IframeParameters: {
        ShowSubmitButton: false,
      },
      RedirectionUrl: redirectionUrl.toString(),
      WebHookUrl: args.webhookUrlBase
        ? `${args.webhookUrlBase}/api/webhooks/bpoint`
        : undefined,
      ProcessTxnData: {
        Action: "payment",
        Amount: pricing.amount,
        AmountOriginal: pricing.amount,
        AmountSurcharge: 0,
        BillerCode: cfg.billerCode,
        Crn1: args.sessionId,
        Crn2: "aquarius-chatbot",
        Crn3: args.urgency,
        Currency: "AUD",
        CurrencyCode: "AUD",
        EmailAddress: args.customerEmail,
        IsTestTxn: cfg.isTestTxn,
        MerchantReference: buildMerchantReference(args.sessionId),
        StoreCard: false,
        SubType: "single",
        Type: "internet",
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[bpoint] AuthKey HTTP failure", {
      event: "bpoint_authkey_http_failed",
      status: res.status,
      body,
    });
    throw new Error(`BPoint AuthKey creation failed: ${res.status}`);
  }

  const data = (await res.json()) as {
    AuthKey?: string | null;
    APIResponse?: { ResponseCode: number; ResponseText: string };
  };
  if (data.APIResponse?.ResponseCode !== 0 || !data.AuthKey) {
    throw new Error(
      `BPoint AuthKey rejected: ${data.APIResponse?.ResponseText ?? "unknown"}`
    );
  }
  return data.AuthKey;
}

export interface BPointTxnResp {
  TxnNumber: string;
  ReceiptNumber?: string;
  Approved?: boolean;
  Crn1: string;
  Amount: number;
  BankResponseCode?: string;
  ResponseCode?: string;
  ResponseText?: string;
}

export interface ProcessIframeTxnResponse {
  APIResponse: { ResponseCode: number; ResponseText: string };
  ResultKey?: string | null;
  RedirectionUrl?: string | null;
}

function formatAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

export async function processIframeTransaction(args: {
  authKey: string;
  sessionId: string;
  urgency: CheckoutUrgency;
  customerEmail?: string;
  customerName?: string;
}): Promise<ProcessIframeTxnResponse> {
  const cfg = getBpointConfig();
  const pricing = PRICING[args.urgency];
  const res = await fetch(
    `${cfg.baseUrl}/txns/processiframetxn/${encodeURIComponent(args.authKey)}`,
    {
      method: "POST",
      headers: {
        Authorization: buildBpointAuthHeader(cfg),
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        TxnReq: {
          Amount: formatAmount(pricing.amount),
          AmountOriginal: formatAmount(pricing.amount),
          AmountSurcharge: "0.00",
          BillerCode: cfg.billerCode,
          CardDetails: args.customerName
            ? { CardHolderName: args.customerName }
            : undefined,
          Crn1: args.sessionId,
          Crn2: "aquarius-chatbot",
          Crn3: args.urgency,
          Currency: "AUD",
          EmailAddress: args.customerEmail,
          MerchantReference: buildMerchantReference(args.sessionId),
          StoreCard: false,
        },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[bpoint] process iframe HTTP failure", {
      event: "bpoint_process_iframe_http_failed",
      status: res.status,
      body,
    });
    throw new Error(`BPoint iframe processing failed: ${res.status}`);
  }

  return (await res.json()) as ProcessIframeTxnResponse;
}

export interface BPointTxnResponse {
  APIResponse: { ResponseCode: number | string; ResponseText: string };
  TxnResp: BPointTxnResp | null;
}

export async function retrieveTransaction(
  resultKey: string
): Promise<BPointTxnResponse> {
  const cfg = getBpointConfig();
  const res = await fetch(
    `${cfg.baseUrl}/txns/${encodeURIComponent(resultKey)}`,
    {
      headers: {
        Authorization: buildBpointAuthHeader(cfg),
        Accept: "application/json",
      },
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[bpoint] retrieveTransaction HTTP failure", {
      event: "bpoint_retrieve_http_failed",
      status: res.status,
      body,
    });
    throw new Error(`BPoint retrieve failed: ${res.status}`);
  }

  return (await res.json()) as BPointTxnResponse;
}

export function isApprovedTransaction(txn: BPointTxnResponse): boolean {
  if (String(txn.APIResponse?.ResponseCode) !== "0" || !txn.TxnResp) {
    return false;
  }
  if (typeof txn.TxnResp.Approved === "boolean") return txn.TxnResp.Approved;
  return (
    String(txn.TxnResp.ResponseCode) === "0" ||
    txn.TxnResp.ResponseText?.toLowerCase() === "approved"
  );
}
