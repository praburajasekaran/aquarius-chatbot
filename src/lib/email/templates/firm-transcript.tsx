import { Heading, Hr, Text } from "@react-email/components";
import { EmailLayout } from "@/lib/email/components/EmailLayout";
import { DataTable } from "@/lib/email/components/DataTable";
import { styles } from "@/lib/email/styles";

export interface FirmTranscriptEmailProps {
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  matterDescription: string;
  urgency: string;
  paymentAmount: number;
  stripeSessionId: string | null;
  transcript?: string;
}

export default function FirmTranscriptEmail({
  clientName,
  clientEmail,
  clientPhone,
  matterDescription,
  urgency,
  paymentAmount,
  stripeSessionId,
  transcript,
}: FirmTranscriptEmailProps) {
  const fee = `$${(paymentAmount / 100).toFixed(2)} AUD`;

  return (
    <EmailLayout preview={`New ${urgency} inquiry — ${clientName}`}>
      <Heading style={styles.heading}>New client inquiry</Heading>
      <DataTable
        rows={[
          { label: "Name", value: clientName },
          { label: "Email", value: clientEmail },
          { label: "Phone", value: clientPhone },
          { label: "Matter", value: matterDescription },
          { label: "Urgency", value: urgency },
          { label: "Payment", value: fee },
          { label: "Stripe session", value: stripeSessionId ?? "N/A" },
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
    </EmailLayout>
  );
}
