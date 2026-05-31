import {
  Heading,
  Hr,
  Link,
  Text,
} from "@react-email/components";
import { BRANDING } from "@/lib/branding";
import { FIRM_CONTACT } from "@/lib/contact";
import { EmailLayout } from "@/lib/email/components/EmailLayout";
import { BrandButton } from "@/lib/email/components/BrandButton";
import { styles } from "@/lib/email/styles";

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

function buildCalendlyPrefillUrl(
  baseUrl: string,
  name: string | undefined,
  email: string | undefined,
  matterRef: string
): string {
  const params = new URLSearchParams();
  if (name) params.set("name", name);
  if (email) params.set("email", email);
  params.set("utm_content", matterRef);
  const query = params.toString();
  return query ? `${baseUrl}?${query}` : baseUrl;
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
    <EmailLayout
      preview={`Your ${BRANDING.firmName} payment receipt & upload link`}
    >
      <Heading style={styles.heading}>Payment received</Heading>

      <Text style={styles.paragraph}>{greeting}</Text>

      <Text style={styles.paragraph}>
        Thank you for your payment of <strong>{amount}</strong> to{" "}
        {BRANDING.firmName}. Your matter reference is{" "}
        <strong>{matterRef}</strong>.
      </Text>

      <Text style={styles.paragraph}>
        When you&apos;re ready, use the secure link below to upload any
        documents related to your matter — charge sheets, court papers,
        photos or anything else you&apos;d like us to see.
      </Text>

      <BrandButton href={uploadLink}>Upload your documents</BrandButton>

      {urgency === "urgent" ? (
        <>
          <Hr style={styles.divider} />
          <Heading as="h2" style={styles.subheading}>
            Next step — please call us
          </Heading>
          <Text style={styles.paragraph}>
            Because you flagged your matter as urgent, the next step is to
            call our office so we can begin work straight away. Please phone
            us on{" "}
            <Link href={FIRM_CONTACT.phoneHref} style={styles.link}>
              {FIRM_CONTACT.phone}
            </Link>{" "}
            during our business hours
            (<strong>{FIRM_CONTACT.businessHours}</strong>).
          </Text>
          <BrandButton href={FIRM_CONTACT.phoneHref} variant="secondary">
            Call {FIRM_CONTACT.phone}
          </BrandButton>
          <Text style={styles.paragraph}>
            If you reach our voicemail outside business hours, leave your
            name and matter reference and we&apos;ll return your call as
            soon as we open.
          </Text>
        </>
      ) : urgency === "non-urgent" && calendlyUrl ? (
        <>
          <Hr style={styles.divider} />
          <Heading as="h2" style={styles.subheading}>
            Next step — book your Legal Strategy Session
          </Heading>
          <Text style={styles.paragraph}>
            If you haven&apos;t already picked a slot in chat, please book
            your Legal Strategy Session using the link below. We&apos;ll
            walk you through your matter and next steps in detail.
          </Text>
          <BrandButton
            href={buildCalendlyPrefillUrl(
              calendlyUrl,
              name,
              clientEmail,
              matterRef
            )}
          >
            Book your session
          </BrandButton>
        </>
      ) : null}

      {transcript && transcript.trim().length > 0 && (
        <>
          <Hr style={styles.divider} />
          <Heading as="h2" style={styles.subheading}>
            Conversation summary
          </Heading>
          {transcript
            .split(/\n{2,}/)
            .map((turn) => turn.trim())
            .filter(Boolean)
            .map((turn, i) => (
              <Text key={i} style={styles.monoBlock}>
                {turn}
              </Text>
            ))}
        </>
      )}

      <Text style={{ ...styles.footer, margin: "24px 0 0" }}>
        This link stays valid for 7 days and can be used multiple times. If
        you didn&apos;t make this payment, please reply to this email right
        away.
      </Text>
    </EmailLayout>
  );
}
