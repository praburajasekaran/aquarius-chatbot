import { Heading, Link, Text } from "@react-email/components";
import { EmailLayout } from "@/lib/email/components/EmailLayout";
import { DataTable, type DataTableRow } from "@/lib/email/components/DataTable";
import { styles } from "@/lib/email/styles";

export type InChatUploadFirmStatus =
  | "Sent to Smokeball"
  | "Manual attach required";

export interface FirmInChatUploadNotificationFile {
  name: string;
  contentType: string;
  sizeBytes: number | null;
  url: string;
  status: InChatUploadFirmStatus;
  detail: string;
}

export interface FirmInChatUploadNotificationProps {
  clientName: string;
  clientEmail: string;
  matterRef: string;
  smokeballMatterId: string | null;
  uploadedAt: string;
  files: FirmInChatUploadNotificationFile[];
}

export default function FirmInChatUploadNotificationEmail({
  clientName,
  clientEmail,
  matterRef,
  smokeballMatterId,
  uploadedAt,
  files,
}: FirmInChatUploadNotificationProps) {
  const displayName = clientName || "(no name)";
  const needsManual = files.some(
    (file) => file.status === "Manual attach required"
  );

  const rows: DataTableRow[] = [
    { label: "Client", value: `${displayName} <${clientEmail}>` },
    { label: "Matter ref", value: matterRef },
    {
      label: "Smokeball matter ID",
      value: smokeballMatterId ?? "(not captured - attach manually)",
    },
    { label: "Uploaded at", value: uploadedAt },
    { label: "Files", value: `${files.length}` },
  ];

  return (
    <EmailLayout preview={`Upload received - ${displayName}`}>
      <Heading style={styles.heading}>Upload received</Heading>
      {needsManual && (
        <Text style={styles.banner}>
          Manual attach required - one or more files were not sent to
          Smokeball automatically.
        </Text>
      )}
      <DataTable rows={rows} />
      <table style={styles.table}>
        <tbody>
          <tr>
            <th style={styles.tableLabelCell}>File</th>
            <th style={styles.tableLabelCell}>Link</th>
            <th style={styles.tableLabelCell}>Status</th>
          </tr>
          {files.map((file, index) => (
            <tr key={`${file.name}-${index}`}>
              <td style={styles.tableValueCell}>
                {file.name}
                <br />
                <Text style={styles.paragraphMuted}>
                  {file.contentType} - {formatSize(file.sizeBytes)}
                </Text>
              </td>
              <td style={styles.tableValueCell}>
                <Link href={file.url} style={styles.link}>
                  Open file
                </Link>
              </td>
              <td style={styles.tableValueCell}>
                {file.status}
                <br />
                <Text style={styles.paragraphMuted}>{file.detail}</Text>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </EmailLayout>
  );
}

function formatSize(sizeBytes: number | null): string {
  return sizeBytes != null ? `${sizeBytes.toLocaleString()} bytes` : "?";
}
