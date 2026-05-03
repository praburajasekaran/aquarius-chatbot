export interface QAPair {
  id: string;
  question: string;
  answer: string;
  keywords: string[];
}

export interface SessionData {
  name: string | null;
  email: string | null;
  phone: string | null;
  matterType: string | null;
  matterDescription: string | null;
  urgency: "urgent" | "non-urgent" | null;
  paymentStatus: "pending" | "paid" | "failed";
  paymentAmount: number | null;
  stripeSessionId: string | null;
  uploadRefs: string[];
  calendlyEvent: string | null;
  createdAt: string;
}

export interface ClientDetails {
  name: string;
  email: string;
  phone: string;
  matterDescription: string;
}

export interface UploadTokenRecord {
  matterRef: string;
  clientEmail: string;
  clientName: string;
  sessionId: string;
  createdAt: string;
}

export interface UploadSessionCookie {
  matterRef: string;
  sessionId: string;
  // Optional for backwards compatibility with cookies issued before
  // clientName was added to the payload — verifyCookie may return a
  // payload without it.
  clientName?: string;
  // SHA-256 hex of the magic-link upload token. Used as the rate-limit
  // bucket key for /api/late-upload/session so the bucket is keyed by an
  // unguessable, per-token value rather than the chat sessionId (which
  // is client-generated and may have low entropy). Optional for
  // backwards compatibility with cookies issued before this field was
  // added — those fall back to hashing the sessionId.
  tokenHash?: string;
  exp: number;
}
