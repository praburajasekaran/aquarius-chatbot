import { Hr, Text } from "@react-email/components";
import { BRANDING } from "@/lib/branding";
import { styles } from "@/lib/email/styles";

export function Footer() {
  return (
    <>
      <Hr style={styles.divider} />
      <Text style={styles.footer}>{BRANDING.emailFooter}</Text>
    </>
  );
}
