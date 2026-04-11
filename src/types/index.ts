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
  exp: number;
}
