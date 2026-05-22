import { Heading, Hr, Link, Section, Text } from "@react-email/components";
import { EmailLayout } from "@/lib/email/components/EmailLayout";
import { BrandButton } from "@/lib/email/components/BrandButton";
import { Footer } from "@/lib/email/components/Footer";
import { snippetMatter } from "@/lib/email-reminders/format-matter";
import {
  LSS_EXPLAINER_BLOCK,
  PAYMENT_1H_BODY,
  PAYMENT_1H_SUBJECT,
  PAYMENT_24H_BODY,
  PAYMENT_24H_SUBJECT,
  UNSUBSCRIBE_LINK_LABEL,
} from "@/lib/email-reminders/copy";

/**
 * Single React Email template for the Phase 4 payment-abandonment
 * re-engagement flow. Renders both 1h hybrid (gentle nudge + LSS explainer
 * tier table) and 24h follow-up (matter snippet inline, no quotes per
 * Decision 4) variants by `variant` prop.
 *
 * Body copy comes from `@/lib/email-reminders/copy` and ships as
 * PENDING_SIGNOFF placeholders until firm-principal sign-off. The route
 * handler (Plan 04-03) calls `assertCopyApproved()` before Resend dispatch
 * so production never sends placeholder strings.
 */

export interface ReengagementPaymentEmailProps {
  variant: "1h" | "24h";
  clientName: string;
  matterDescription: string;
  resumeUrl: string;
  unsubscribeUrl: string;
}

export default function ReengagementPaymentEmail({
  variant,
  clientName,
  matterDescription,
  resumeUrl,
  unsubscribeUrl,
}: ReengagementPaymentEmailProps) {
  const matterSnippet = snippetMatter(matterDescription);
  const subject =
    variant === "1h" ? PAYMENT_1H_SUBJECT : PAYMENT_24H_SUBJECT;
  const body =
    variant === "1h"
      ? PAYMENT_1H_BODY({
          clientName,
          matterSnippet,
          resumeUrl,
          unsubscribeUrl,
        })
      : PAYMENT_24H_BODY({
          clientName,
          matterSnippet,
          resumeUrl,
          unsubscribeUrl,
        });

  return (
    <EmailLayout preview={subject} showFooter={false}>
      <Heading>{subject}</Heading>
      <Text>Hi {clientName},</Text>
      <Text>{body}</Text>

      {variant === "1h" && (
        <Section>
          <Hr />
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left">{LSS_EXPLAINER_BLOCK.urgentTitle}</th>
                <th align="left">{LSS_EXPLAINER_BLOCK.nonUrgentTitle}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{LSS_EXPLAINER_BLOCK.urgentPrice}</td>
                <td>{LSS_EXPLAINER_BLOCK.nonUrgentPrice}</td>
              </tr>
              <tr>
                <td>{LSS_EXPLAINER_BLOCK.urgentDescription}</td>
                <td>{LSS_EXPLAINER_BLOCK.nonUrgentDescription}</td>
              </tr>
              <tr>
                <td>{LSS_EXPLAINER_BLOCK.urgentNextStep}</td>
                <td>{LSS_EXPLAINER_BLOCK.nonUrgentNextStep}</td>
              </tr>
            </tbody>
          </table>
          <Hr />
        </Section>
      )}

      {variant === "24h" && (
        <Text>Re: your inquiry about — {matterSnippet}</Text>
      )}

      <BrandButton href={resumeUrl}>Resume payment</BrandButton>

      <Text>
        <Link href={unsubscribeUrl}>{UNSUBSCRIBE_LINK_LABEL}</Link>
      </Text>

      <Footer />
    </EmailLayout>
  );
}
