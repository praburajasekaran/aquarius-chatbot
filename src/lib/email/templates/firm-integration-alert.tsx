import { Heading, Text } from "@react-email/components";
import { EmailLayout } from "@/lib/email/components/EmailLayout";
import { DataTable, type DataTableRow } from "@/lib/email/components/DataTable";
import { styles } from "@/lib/email/styles";

export interface FirmIntegrationAlertProps {
  title: string;
  reason: string;
  sessionId: string;
  clientName?: string | null;
  clientEmail?: string | null;
  smokeballMatterId?: string | null;
  details?: Record<string, string | number | boolean | null | undefined>;
}

export default function FirmIntegrationAlertEmail({
  title,
  reason,
  sessionId,
  clientName,
  clientEmail,
  smokeballMatterId,
  details,
}: FirmIntegrationAlertProps) {
  const rows: DataTableRow[] = [
    { label: "Reason", value: reason },
    { label: "Matter ref", value: sessionId },
  ];

  if (clientName) rows.push({ label: "Client", value: clientName });
  if (clientEmail) rows.push({ label: "Email", value: clientEmail });
  if (smokeballMatterId) {
    rows.push({ label: "Smokeball matter ID", value: smokeballMatterId });
  }
  for (const [label, value] of Object.entries(details ?? {})) {
    if (value == null || value === "") continue;
    rows.push({ label, value: String(value) });
  }

  return (
    <EmailLayout preview={title}>
      <Heading style={styles.heading}>{title}</Heading>
      <Text style={styles.banner}>
        Manual follow-up required — an automation step did not complete.
      </Text>
      <DataTable rows={rows} />
    </EmailLayout>
  );
}
