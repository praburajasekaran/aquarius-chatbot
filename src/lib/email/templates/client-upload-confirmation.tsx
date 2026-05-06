import { Heading, Text } from "@react-email/components";
import { BRANDING } from "@/lib/branding";
import { EmailLayout } from "@/lib/email/components/EmailLayout";
import { styles } from "@/lib/email/styles";

export interface ClientUploadConfirmationProps {
  clientName: string;
  fileName: string;
}

export default function ClientUploadConfirmationEmail({
  clientName,
  fileName,
}: ClientUploadConfirmationProps) {
  const greeting = clientName ? `Hi ${clientName},` : "Hello,";

  return (
    <EmailLayout
      preview={`We received "${fileName}" for your matter — ${BRANDING.firmName}`}
    >
      <Heading style={styles.heading}>We received your upload</Heading>
      <Text style={styles.paragraph}>{greeting}</Text>
      <Text style={styles.paragraph}>
        We just received <strong>&ldquo;{fileName}&rdquo;</strong> for your
        matter with {BRANDING.firmName}.
      </Text>
      <Text style={styles.paragraph}>
        If this wasn&apos;t you, please reply to this email immediately so
        we can secure your upload link.
      </Text>
    </EmailLayout>
  );
}

// Plaintext fallback for forwarding-to-IT scenarios. Resend auto-generates
// one from the React tree, but its quality varies — we supply this
// explicitly because this is the email a recipient most likely forwards to
// IT to verify legitimacy.
export function clientUploadConfirmationText({
  clientName,
  fileName,
}: ClientUploadConfirmationProps): string {
  return [
    `Hi ${clientName || "there"},`,
    "",
    `We just received "${fileName}" for your matter with ${BRANDING.firmName}.`,
    "If this wasn't you, please reply to this email immediately so we can secure your upload link.",
    "",
    `— ${BRANDING.firmName}`,
  ].join("\n");
}
