import { Heading, Hr, Text } from "@react-email/components";
import { EmailLayout } from "@/lib/email/components/EmailLayout";
import { BrandButton } from "@/lib/email/components/BrandButton";
import { DataTable } from "@/lib/email/components/DataTable";
import { styles } from "@/lib/email/styles";

export interface FirmLeadEmailProps {
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  matterDescription: string;
  urgency: "urgent" | "non-urgent";
  displayPrice: string;
  resumeUrl: string;
  transcript?: string;
}

export default function FirmLeadEmail({
  clientName,
  clientEmail,
  clientPhone,
  matterDescription,
  urgency,
  displayPrice,
  resumeUrl,
  transcript,
}: FirmLeadEmailProps) {
  return (
    <EmailLayout
      preview={`New ${urgency} lead — ${clientName} (awaiting payment)`}
    >
      <Heading style={styles.heading}>
        New client inquiry (awaiting payment)
      </Heading>
      <DataTable
        rows={[
          { label: "Name", value: clientName },
          { label: "Email", value: clientEmail },
          { label: "Phone", value: clientPhone },
          { label: "Matter", value: matterDescription },
          { label: "Urgency", value: urgency },
          { label: "Fee", value: displayPrice },
        ]}
      />

      {transcript && transcript.trim().length > 0 && (
        <>
          <Hr style={styles.divider} />
          <Heading as="h2" style={styles.subheading}>
            Chat transcript
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

      <Text style={styles.paragraphMuted}>
        Payment has not yet been completed. A second notification will be
        sent once payment is confirmed.
      </Text>
      <BrandButton href={resumeUrl} variant="secondary">
        View payment link
      </BrandButton>
    </EmailLayout>
  );
}
