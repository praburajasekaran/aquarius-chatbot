import { Heading, Text } from "@react-email/components";
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
}

export default function FirmLeadEmail({
  clientName,
  clientEmail,
  clientPhone,
  matterDescription,
  urgency,
  displayPrice,
  resumeUrl,
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
      <Text style={styles.paragraphMuted}>
        Payment has not yet been completed. You will receive a second
        notification with the chat transcript once payment is confirmed.
      </Text>
      <BrandButton href={resumeUrl} variant="secondary">
        View payment link
      </BrandButton>
    </EmailLayout>
  );
}
