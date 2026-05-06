import { Button, Section } from "@react-email/components";
import type { ReactNode } from "react";
import { styles } from "@/lib/email/styles";

interface BrandButtonProps {
  href: string;
  variant?: "primary" | "secondary";
  children: ReactNode;
}

export function BrandButton({
  href,
  variant = "primary",
  children,
}: BrandButtonProps) {
  const buttonStyle =
    variant === "secondary" ? styles.buttonSecondary : styles.buttonPrimary;
  return (
    <Section style={styles.buttonWrap}>
      <Button style={buttonStyle} href={href}>
        {children}
      </Button>
    </Section>
  );
}
