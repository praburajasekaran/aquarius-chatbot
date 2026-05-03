export const BRANDING = {
  firmName: process.env.NEXT_PUBLIC_FIRM_NAME ?? "Demo Law Firm",
  tagline: process.env.NEXT_PUBLIC_FIRM_TAGLINE ?? "Criminal Law Assistant",
  privacyUrl: process.env.NEXT_PUBLIC_PRIVACY_URL ?? "/privacy",
  emailSenderName: process.env.FIRM_EMAIL_SENDER_NAME ?? "Law Assistant",
  get pageTitle() {
    return `${this.firmName} — ${this.tagline}`;
  },
  get pageDescription() {
    return `Get answers to your criminal law questions and book a Legal Strategy Session with ${this.firmName}.`;
  },
  get welcomeMessage() {
    return `Welcome to ${this.firmName}. I'm here to help with your criminal law questions and guide you through booking a Legal Strategy Session. Please note: I provide general information only — not legal advice. How can I help you today?`;
  },
  get welcomeShort() {
    return `Welcome to ${this.firmName}. Ask me anything about criminal law.`;
  },
  get emailFooter() {
    return `This email was sent by the ${this.firmName} chatbot in response to your inquiry. ${this.firmName} provides general information only — not legal advice. Reply to this email if you have any questions.`;
  },
  get emailLogoHtml() {
    const base = (process.env.NEXT_PUBLIC_URL ?? "").replace(/\/$/, "");
    const logoPath =
      process.env.NEXT_PUBLIC_FIRM_LOGO_URL ?? "/aquarius-logo.jpg";
    const logoUrl = /^https?:\/\//i.test(logoPath)
      ? logoPath
      : `${base}${logoPath.startsWith("/") ? "" : "/"}${logoPath}`;
    return `<div style="text-align:center;padding:16px 0 24px"><img src="${logoUrl}" alt="${this.firmName}" width="180" style="display:inline-block;height:auto;max-width:180px;border:0;outline:none;text-decoration:none" /></div>`;
  },
};
