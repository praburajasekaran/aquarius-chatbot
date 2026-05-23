import { Heading, Hr, Text } from "@react-email/components";
import { EmailLayout } from "@/lib/email/components/EmailLayout";
import { styles } from "@/lib/email/styles";
import type { KnowledgeGap } from "@/lib/tools/log-unanswered";

export interface UnansweredReportEmailProps {
  month: string;
  gapCount: number;
  totalTimesAsked: number;
  gaps: KnowledgeGap[];
}

export default function UnansweredReportEmail({
  month,
  gapCount,
  totalTimesAsked,
  gaps,
}: UnansweredReportEmailProps) {
  return (
    <EmailLayout preview={`${gapCount} knowledge gaps — ${month}`}>
      <Heading style={styles.heading}>
        Knowledge Gap Report — {month}
      </Heading>

      {gapCount === 0 ? (
        <Text style={styles.paragraph}>
          No knowledge gaps were captured this month. The monthly enrichment
          check still ran successfully.
        </Text>
      ) : (
        <>
          <Text style={styles.paragraph}>
            {gapCount} knowledge gap{gapCount === 1 ? "" : "s"} appeared across{" "}
            {totalTimesAsked} visitor question
            {totalTimesAsked === 1 ? "" : "s"}. These are visitor information
            questions that did not match the approved knowledge base.
          </Text>

          <Hr style={styles.divider} />

          <Heading as="h2" style={styles.subheading}>
            Gaps for knowledgebase enrichment
          </Heading>

          {gaps.map((gap, i) => (
            <Text key={i} style={styles.paragraph}>
              <strong>{i + 1}.</strong> {gap.text}
              <br />
              <span style={{ color: "#666", fontSize: "13px" }}>
                Times asked: {gap.timesAsked} · Category: {gap.category}
              </span>
            </Text>
          ))}
        </>
      )}

      <Hr style={styles.divider} />

      <Text style={{ ...styles.paragraph, color: "#666", fontSize: "13px" }}>
        This is an automated monthly report from Banjo, the AI assistant at
        Aquarius Lawyers. It includes sanitized visitor question wording only,
        with exact normalized repeats merged for knowledgebase enrichment.
      </Text>
    </EmailLayout>
  );
}
