import { Heading, Link, Text } from "@react-email/components";
import { BRANDING } from "@/lib/branding";
import { FIRM_CONTACT } from "@/lib/contact";
import { EmailLayout } from "@/lib/email/components/EmailLayout";
import { BrandButton } from "@/lib/email/components/BrandButton";
import { DataTable } from "@/lib/email/components/DataTable";
import { styles } from "@/lib/email/styles";

export interface ClientInquiryEmailProps {
  clientName: string;
  matterDescription: string;
  urgency: "urgent" | "non-urgent";
  displayPrice: string;
  resumeUrl: string;
  calendlyPrefillUrl: string;
  calendlyUrl: string;
}

export default function ClientInquiryEmail({
  clientName,
  matterDescription,
  urgency,
  displayPrice,
  resumeUrl,
  calendlyPrefillUrl,
  calendlyUrl,
}: ClientInquiryEmailProps) {
  const subjectMatterLabel =
    urgency === "urgent"
      ? "Initial Deposit for Urgent Court Matter"
      : "Legal Strategy Session";

  return (
    <EmailLayout
      preview={`Your ${subjectMatterLabel} inquiry — ${BRANDING.firmName}`}
    >
      <Heading style={styles.heading}>Hi {clientName},</Heading>

      <Text style={styles.paragraph}>
        Thanks for your inquiry with {BRANDING.firmName}. Here&apos;s a quick
        summary of what you shared with us:
      </Text>

      <DataTable
        rows={[
          { label: "Matter", value: matterDescription },
          { label: "Urgency", value: urgency },
          { label: "Fee", value: displayPrice },
        ]}
      />

      <BrandButton href={resumeUrl}>
        Complete payment — {displayPrice}
      </BrandButton>

      <Text style={styles.paragraphMuted}>
        If you&apos;ve already paid, this link will take you to a
        confirmation page instead.
      </Text>

      {urgency === "urgent" ? (
        <Text style={styles.paragraph}>
          For urgent matters, please call us on{" "}
          <Link href={FIRM_CONTACT.phoneHref} style={styles.link}>
            {FIRM_CONTACT.phone}
          </Link>{" "}
          during our business hours
          (<strong>{FIRM_CONTACT.businessHours}</strong>). We&apos;ll be
          ready to help as soon as we hear from you.
        </Text>
      ) : (
        <Text style={styles.paragraph}>
          For non-urgent matters, we&apos;ll schedule your Legal Strategy
          Session via Calendly. You can pick a slot at any time here:
          <br />
          <Link href={calendlyPrefillUrl} style={styles.link}>
            {calendlyUrl}
          </Link>
        </Text>
      )}
    </EmailLayout>
  );
}
