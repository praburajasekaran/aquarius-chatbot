import { Heading, Link } from "@react-email/components";
import { EmailLayout } from "@/lib/email/components/EmailLayout";
import { DataTable, type DataTableRow } from "@/lib/email/components/DataTable";
import { styles } from "@/lib/email/styles";

export interface FirmBookingNotificationProps {
  clientName: string;
  clientEmail: string;
  matterDescription?: string;
  urgency?: "urgent" | "non-urgent";
  startTimeLocal: string;
  eventUri: string;
  inviteeUri: string;
  stripeSessionId?: string | null;
}

export default function FirmBookingNotificationEmail({
  clientName,
  clientEmail,
  matterDescription,
  urgency,
  startTimeLocal,
  eventUri,
  inviteeUri,
  stripeSessionId,
}: FirmBookingNotificationProps) {
  const rows: DataTableRow[] = [
    { label: "Client", value: clientName },
    { label: "Email", value: clientEmail },
  ];
  if (urgency) rows.push({ label: "Urgency", value: urgency });
  if (matterDescription) {
    rows.push({ label: "Matter", value: matterDescription });
  }
  rows.push({ label: "Start time", value: startTimeLocal });
  rows.push({
    label: "Calendly event",
    value: (
      <Link href={eventUri} style={styles.link}>
        {eventUri}
      </Link>
    ),
  });
  rows.push({
    label: "Calendly invitee",
    value: (
      <Link href={inviteeUri} style={styles.link}>
        {inviteeUri}
      </Link>
    ),
  });
  if (stripeSessionId) {
    rows.push({ label: "Stripe session", value: stripeSessionId });
  }

  return (
    <EmailLayout
      preview={`New Legal Strategy Session booking — ${clientName}`}
    >
      <Heading style={styles.heading}>
        New Legal Strategy Session booking
      </Heading>
      <DataTable rows={rows} />
    </EmailLayout>
  );
}
