// BPoint UAT test-card conventions. Sources:
// - https://bpoint.com.au/developers/v3/partialViews/Sections/testmodetxn/description.html
// - https://www.bpoint.com.au/backoffice/media/documents/Testing(Phone,Internet,DDCC).pdf
// See .planning/phases/04-validation/04-RESEARCH.md §"Standard Stack".
//
// IMPORTANT: BPoint uses response-code SIMULATION, not PAN-per-scenario like Stripe.
// One PAN per scheme; bank response is driven by amount OR magic expiry OR magic CVN.
// Aquarius keeps PRICING amounts pinned ($132000 / $72600 — both end in "00" → approved)
// and uses magic expiry `99XX` to force specific codes.

export const TEST_PANS = {
  mastercard: "5123456789012346", // BPoint's documented default
  mastercard2Series: "2720010040360012",
  visa: "4987654321098769",
  amex: "345678901234564",
  diners: "30123456789019",
  jcb: "3530111333300000",
} as const;

// Use a future-dated expiry like "12/29" for the happy path; amounts stay at real PRICING.
export const NORMAL_EXPIRY = "12/29";

// Magic-expiry codes: expiry `99XX` → bank response code `XX`. PRESERVES amount.
export const MAGIC_EXPIRY = {
  doNotHonour: "99/05", // "Do not honour" — declined bucket
  expiredCard: "99/33", // "Expired card" — declined bucket (alt: 99/54)
  expiredCardAlt: "99/54",
  invalidCard: "99/14", // "Invalid card number"
  pickUpCard: "99/04",
} as const;

// Magic CVN codes — force CVN-response codes without changing amount/expiry.
export const MAGIC_CVN = {
  cvnResponseN: "987", // CVN response "N" + bank code 05 → invalid-card bucket
  cvnResponseU: "876",
  cvnResponseP: "765",
} as const;

// Magic amount — triggers a 50-second delay then PT_G5. ONLY used if exercising
// the retrieveTransaction timeout path. NOT a declared TEST-03 scenario.
export const MAGIC_AMOUNT_TIMEOUT = 11199; // $111.99 in cents

export type MagicExpiryKey = keyof typeof MAGIC_EXPIRY;
export type MagicCvnKey = keyof typeof MAGIC_CVN;
