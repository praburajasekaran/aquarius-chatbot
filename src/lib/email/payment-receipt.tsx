import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { BRANDING } from "@/lib/branding";

export interface PaymentReceiptProps {
  name?: string;
  matterRef: string;
  amountCents: number;
  uploadLink: string;
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

const footer: React.CSSProperties = {
  color: "#777777",
  fontSize: "13px",
  lineHeight: "20px",
  margin: "24px 0 0",
};
