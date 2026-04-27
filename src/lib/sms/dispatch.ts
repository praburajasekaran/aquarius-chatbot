import { parsePhoneNumber } from "libphonenumber-js/min";

/**
 * Convert an AU phone number (any common format: "0412 345 678",
 * "+61412345678", "0412-345-678") to E.164 ("+61412345678").
 *
 * Idempotent on already-E.164 input.
 * Throws on unparseable input — caller MUST wrap in try/catch.
 */
export function toE164AU(phone: string): string {
  try {
    const parsed = parsePhoneNumber(phone, "AU");
    if (!parsed || !parsed.isValid()) {
      throw new Error("invalid");
    }
    return parsed.format("E.164");
  } catch {
    throw new Error(`[sms] Cannot normalise to E.164: "${phone}"`);
  }
}

/**
 * AU landline detection. Expects E.164 input (call AFTER toE164AU).
 * AU mobile E.164 numbers always start with "+614"; everything else
 * under "+61" is a landline (02/03/07/08 area codes).
 */
export function isLandline(e164: string): boolean {
  return e164.startsWith("+61") && !e164.startsWith("+614");
}

/**
 * Mask all but the last 4 digits of an E.164 phone number for logging.
 * "+61412345678" -> "+61******5678"
 * Length-agnostic; preserves leading "+".
 */
export function redact(e164: string): string {
  if (e164.length <= 4) return "****";
  const prefix = "+61";
  const masked = e164.slice(prefix.length, -4).replace(/\d/g, "*");
  return prefix + masked + e164.slice(-4);
}

/**
 * Send an SMS via the ClickSend REST API.
 *
 * Provider-agnostic seam (SMS-02): accepts only primitive arguments.
 * Never throws — degrades gracefully on missing credentials, invalid
 * phone format, landline numbers, and ClickSend API errors.
 *
 * Order of operations (do not change):
 *   1. Env-var guard      — absent creds → warn + return
 *   2. toE164AU(to)       — parse failure → warn + return
 *   3. isLandline(e164)   — landline → info + return
 *   4. fetch ClickSend    — !ok → error log; ok → info log
 *
 * All phone numbers in logs are masked via redact(). The raw E.164
 * value MUST NEVER appear in any console call (OPS-03).
 */
export async function sendSms(to: string, body: string): Promise<void> {
  const username = process.env.CLICKSEND_USERNAME;
  const apiKey = process.env.CLICKSEND_API_KEY;
  const senderId = process.env.CLICKSEND_SENDER_ID ?? "AquariusLaw";

  if (!username || !apiKey) {
    console.warn("[sms] CLICKSEND_* env vars missing — SMS skipped", {
      event: "sms_skipped",
      reason: "no_credentials",
    });
    return;
  }

  let e164: string;
  try {
    e164 = toE164AU(to);
  } catch {
    console.warn("[sms] invalid phone format — SMS skipped", {
      event: "sms_skipped",
      reason: "invalid_phone",
    });
    return;
  }

  if (isLandline(e164)) {
    console.info("[sms] landline detected — SMS skipped", {
      event: "sms_skipped",
      reason: "landline",
      to: redact(e164),
    });
    return;
  }

  const auth = Buffer.from(`${username}:${apiKey}`).toString("base64");

  let res: Response;
  try {
    res = await fetch("https://rest.clicksend.com/v3/sms/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        messages: [
          {
            to: e164,
            body,
            from: senderId,
          },
        ],
      }),
    });
  } catch (err) {
    console.error("[sms] ClickSend fetch threw", {
      event: "sms_failed",
      to: redact(e164),
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[sms] ClickSend non-ok response", {
      event: "sms_failed",
      status: res.status,
      to: redact(e164),
      body: text,
    });
    return;
  }

  console.info("[sms] sent", {
    event: "sms_sent",
    to: redact(e164),
  });
}
