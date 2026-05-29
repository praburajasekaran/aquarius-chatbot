import { Heading, Hr, Text } from "@react-email/components";
import { EmailLayout } from "@/lib/email/components/EmailLayout";
import { styles } from "@/lib/email/styles";
import type { OpsEventRecord } from "@/lib/ops-events";
import { summarizeOpsEvents } from "@/lib/ops-events";

export interface OpsReportEmailProps {
  label: string;
  events: OpsEventRecord[];
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "None captured";
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function OpsReportEmail({ label, events }: OpsReportEmailProps) {
  const summary = summarizeOpsEvents(events);
  const actionableCount = summary.bySeverity.error + summary.bySeverity.warning;

  return (
    <EmailLayout preview={`${actionableCount} ops events — ${label}`}>
      <Heading style={styles.heading}>Ops Report — {label}</Heading>

      <Text style={styles.paragraph}>
        {summary.bySeverity.error} error{summary.bySeverity.error === 1 ? "" : "s"},{" "}
        {summary.bySeverity.warning} warning
        {summary.bySeverity.warning === 1 ? "" : "s"}, and {summary.bySeverity.info} info
        event{summary.bySeverity.info === 1 ? "" : "s"} were captured.
      </Text>

      <Hr style={styles.divider} />

      <Heading as="h2" style={styles.subheading}>Upload health</Heading>
      <Text style={styles.paragraph}>
        Successful upload batches: {summary.uploadSuccesses}
        <br />
        Upload warnings/errors: {summary.uploadFailures}
        <br />
        Largest successful file: {formatBytes(summary.largestUploadBytes)}
      </Text>

      <Heading as="h2" style={styles.subheading}>Top event types</Heading>
      {summary.topEvents.length === 0 ? (
        <Text style={styles.paragraph}>No ops events were captured in this period.</Text>
      ) : (
        summary.topEvents.map((item, i) => (
          <Text key={item.name} style={styles.paragraph}>
            <strong>{i + 1}.</strong> {item.name} — {item.count}
          </Text>
        ))
      )}

      <Heading as="h2" style={styles.subheading}>Top areas</Heading>
      {summary.topAreas.map((item, i) => (
        <Text key={item.name} style={styles.paragraph}>
          <strong>{i + 1}.</strong> {item.name} — {item.count}
        </Text>
      ))}

      <Heading as="h2" style={styles.subheading}>Recent errors and warnings</Heading>
      {summary.recentHighPriority.length === 0 ? (
        <Text style={styles.paragraph}>No errors or warnings were captured.</Text>
      ) : (
        summary.recentHighPriority.map((event, i) => (
          <Text key={`${event.ts}-${i}`} style={styles.paragraph}>
            <strong>{event.severity.toUpperCase()}</strong> {event.event}
            <br />
            <span style={{ color: "#666", fontSize: "13px" }}>
              {event.area} · {event.ts}
            </span>
            <br />
            {event.message}
          </Text>
        ))
      )}

      <Hr style={styles.divider} />

      <Text style={{ ...styles.paragraph, color: "#666", fontSize: "13px" }}>
        This automated report includes application-captured errors and warnings
        only. Sensitive tokens, file contents, and contact details are sanitized
        before storage.
      </Text>
    </EmailLayout>
  );
}
