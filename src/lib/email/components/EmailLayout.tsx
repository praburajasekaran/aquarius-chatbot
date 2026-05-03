import {
  Body,
  Container,
  Head,
  Html,
  Preview,
} from "@react-email/components";
import type { ReactNode } from "react";
import { Logo } from "@/lib/email/components/Logo";
import { Footer } from "@/lib/email/components/Footer";
import { styles } from "@/lib/email/styles";

interface EmailLayoutProps {
  preview: string;
  children: ReactNode;
  showFooter?: boolean;
}

export function EmailLayout({
  preview,
  children,
  showFooter = true,
}: EmailLayoutProps) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Logo />
          {children}
          {showFooter && <Footer />}
        </Container>
      </Body>
    </Html>
  );
}
