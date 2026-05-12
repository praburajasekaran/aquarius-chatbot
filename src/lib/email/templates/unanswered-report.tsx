import { Heading, Hr, Text } from "@react-email/components";
import { EmailLayout } from "@/lib/email/components/EmailLayout";
import { styles } from "@/lib/email/styles";

export interface UnansweredReportEmailProps {
  month: string;
  questionCount: number;
  questions: Array<{ text: string; firstSeen: string }>;
}

export default function UnansweredReportEmail({
  month,
  questionCount,
  questions,
}: UnansweredReportEmailProps) {
  return (
    <EmailLayout
      preview={`${questionCount} unanswered questions — ${month}`}
    >
      <Heading style={styles.heading}>
        Unanswered Questions Report — {month}
      </Heading>

      {questionCount === 0 ? (
        <Text style={styles.paragraph}>
          No unanswered questions this month. Every visitor question matched the
          knowledge base.
        </Text>
      ) : (
        <>
          <Text style={styles.paragraph}>
            {questionCount} unique question{questionCount === 1 ? "" : "s"}{" "}
            {questionCount === 1 ? "was" : "were"} asked that did not match any
            entry in the criminal law knowledge base.
          </Text>

          <Hr style={styles.divider} />

          <Heading as="h2" style={styles.subheading}>
            Questions
          </Heading>

          {questions.map((q, i) => (
            <Text key={i} style={styles.paragraph}>
              <strong>{i + 1}.</strong> {q.text}
              <br />
              <span style={{ color: "#666", fontSize: "13px" }}>
                First asked:{" "}
                {new Date(q.firstSeen).toLocaleDateString("en-AU", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </span>
            </Text>
          ))}
        </>
      )}

      <Hr style={styles.divider} />

      <Text style={{ ...styles.paragraph, color: "#666", fontSize: "13px" }}>
        This is an automated monthly report from Banjo, the AI assistant at
        Aquarius Lawyers. Questions are deduplicated — if the same question was
        asked multiple times, it appears once with the most recent date.
      </Text>
    </EmailLayout>
  );
}
