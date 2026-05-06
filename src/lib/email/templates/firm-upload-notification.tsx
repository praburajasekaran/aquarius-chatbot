import { Heading, Link, Text } from "@react-email/components";
import { EmailLayout } from "@/lib/email/components/EmailLayout";
import { DataTable, type DataTableRow } from "@/lib/email/components/DataTable";
import { styles } from "@/lib/email/styles";

export interface FirmUploadNotificationProps {
  clientName: string;
  clientEmail: string;
  matterRef: string;
  smokeballMatterId: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number | null;
  url: string;
  attachZapStatus: string;
  uploadedAt: string;
  needsManual: boolean;
}

export default function FirmUploadNotificationEmail({
  clientName,
  clientEmail,
  matterRef,
  smokeballMatterId,
  fileName,
  contentType,
  sizeBytes,
  url,
  attachZapStatus,
  uploadedAt,
  needsManual,
}: FirmUploadNotificationProps) {
  const displayName = clientName || "(no name)";
  const sizeDisplay =
    sizeBytes != null ? `${sizeBytes.toLocaleString()} bytes` : "?";

  const rows: DataTableRow[] = [
    { label: "Client", value: `${displayName} <${clientEmail}>` },
    { label: "Matter ref", value: matterRef },
    {
      label: "Smokeball matter ID",
      value: smokeballMatterId ?? "(not captured — attach manually)",
    },
    { label: "File", value: `${fileName} (${contentType})` },
    { label: "Size", value: sizeDisplay },
    {
      label: "URL",
      value: (
        <Link href={url} style={styles.link}>
          {url}
        </Link>
      ),
    },
    { label: "Smokeball Zap status", value: attachZapStatus },
    { label: "Uploaded at", value: uploadedAt },
  ];

  return (
    <EmailLayout
      preview={`Upload received — ${displayName} (${fileName})`}
    >
      <Heading style={styles.heading}>Upload received</Heading>
      {needsManual && (
        <Text style={styles.banner}>
          Manual attach required — Smokeball Zap did not complete
          automatically.
        </Text>
      )}
      <DataTable rows={rows} />
    </EmailLayout>
  );
}
