import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { BRANDING } from "@/lib/branding";
import { FIRM_CONTACT } from "@/lib/contact";

export interface PaymentReceiptProps {
  name?: string;
  matterRef: string;
  amountCents: number;
  uploadLink: string;
  urgency?: "urgent" | "non-urgent" | null;
  calendlyUrl?: string;
  clientEmail?: string;
  transcript?: string;
}

function formatAud(cents: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(cents / 100);
}

export default function PaymentReceipt({
  name,
  matterRef,
  amountCents,
  uploadLink,
  urgency,
  calendlyUrl,
  clientEmail,
  transcript,
}: PaymentReceiptProps) {
  const greeting = name ? `Hi ${name},` : "Hello,";
  const amount = formatAud(amountCents);

  return (
    <Html>
      <Head />
      <Preview>Your {BRANDING.firmName} payment receipt &amp; upload link</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>Payment received</Heading>

          <Text style={paragraph}>{greeting}</Text>

          <Text style={paragraph}>
            Thank you for your payment of <strong>{amount}</strong> to{" "}
            {BRANDING.firmName}. Your matter reference is{" "}
            <strong>{matterRef}</strong>.
          </Text>

          <Text style={paragraph}>
            When you&apos;re ready, use the secure link below to upload any
            documents related to your matter — charge sheets, court papers,
            photos or anything else you&apos;d like us to see.
          </Text>

          <Section style={buttonWrap}>
            <Button style={button} href={uploadLink}>
              Upload your documents
            </Button>
          </Section>

          {urgency === "urgent" ? (
            <>
              <Hr style={divider} />
              <Heading as="h2" style={subheading}>
                Next step — please call us
              </Heading>
              <Text style={paragraph}>
                Because you flagged your matter as urgent, the next step is to
                call our office so we can begin work straight away. Please
                phone us on{" "}
                <Link href={FIRM_CONTACT.phoneHref} style={phoneLink}>
                  {FIRM_CONTACT.phone}
                </Link>{" "}
                during our business hours
                (<strong>{FIRM_CONTACT.businessHours}</strong>).
              </Text>
              <Section style={buttonWrap}>
                <Button style={callButton} href={FIRM_CONTACT.phoneHref}>
                  Call {FIRM_CONTACT.phone}
                </Button>
              </Section>
              <Text style={paragraph}>
                If you reach our voicemail outside business hours, leave your
                name and matter reference and we&apos;ll return your call as
                soon as we open.
              </Text>
            </>
          ) : urgency === "non-urgent" && calendlyUrl ? (
            <>
              <Hr style={divider} />
              <Heading as="h2" style={subheading}>
                Next step — book your Legal Strategy Session
              </Heading>
              <Text style={paragraph}>
                If you haven&apos;t already picked a slot in chat, please book
                your Legal Strategy Session using the link below. We&apos;ll
                walk you through your matter and next steps in detail.
              </Text>
              <Section style={buttonWrap}>
                <Button
                  style={button}
                  href={buildCalendlyPrefillUrl(calendlyUrl, name, clientEmail)}
                >
                  Book your session
                </Button>
              </Section>
            </>
          ) : null}

          {transcript && transcript.trim().length > 0 && (
            <>
              <Hr style={divider} />
              <Heading as="h2" style={subheading}>
                Conversation summary
              </Heading>
              {transcript
                .split(/\n{2,}/)
                .map((turn) => turn.trim())
                .filter(Boolean)
                .map((turn, i) => (
                  <Text key={i} style={transcriptText}>
                    {turn}
                  </Text>
                ))}
            </>
          )}

          <Text style={footer}>
            This link stays valid for 7 days and can be used multiple times. If
            you didn&apos;t make this payment, please reply to this email right
            away.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

function buildCalendlyPrefillUrl(
  baseUrl: string,
  name?: string,
  email?: string
): string {
  const params = new URLSearchParams();
  if (name) params.set("name", name);
  if (email) params.set("email", email);
  const query = params.toString();
  return query ? `${baseUrl}?${query}` : baseUrl;
}

const body: React.CSSProperties = {
  backgroundColor: "#f6f8fa",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
};

const container: React.CSSProperties = {
  backgroundColor: "#ffffff",
  margin: "40px auto",
  padding: "32px",
  maxWidth: "560px",
  borderRadius: "8px",
};

const heading: React.CSSProperties = {
  color: "#1a1a1a",
  fontSize: "24px",
  fontWeight: 600,
  margin: "0 0 16px",
};

const paragraph: React.CSSProperties = {
  color: "#333333",
  fontSize: "16px",
  lineHeight: "24px",
  margin: "0 0 16px",
};

const buttonWrap: React.CSSProperties = {
  margin: "24px 0",
  textAlign: "center",
};

const button: React.CSSProperties = {
  backgroundColor: "#61BBCA",
  color: "#ffffff",
  fontSize: "16px",
  fontWeight: 600,
  padding: "12px 24px",
  borderRadius: "6px",
  textDecoration: "none",
  display: "inline-block",
};

const callButton: React.CSSProperties = {
  backgroundColor: "#085a66",
  color: "#ffffff",
  fontSize: "16px",
  fontWeight: 600,
  padding: "12px 24px",
  borderRadius: "6px",
  textDecoration: "none",
  display: "inline-block",
};

const divider: React.CSSProperties = {
  borderColor: "#e5e5e5",
  margin: "32px 0 24px",
};

const subheading: React.CSSProperties = {
  color: "#1a1a1a",
  fontSize: "18px",
  fontWeight: 600,
  margin: "0 0 12px",
};

const phoneLink: React.CSSProperties = {
  color: "#085a66",
  fontWeight: 600,
  textDecoration: "none",
};

const footer: React.CSSProperties = {
  color: "#777777",
  fontSize: "13px",
  lineHeight: "20px",
  margin: "24px 0 0",
};

const transcriptText: React.CSSProperties = {
  color: "#333333",
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: "13px",
  lineHeight: "20px",
  whiteSpace: "pre-wrap",
  margin: "0 0 10px",
};
