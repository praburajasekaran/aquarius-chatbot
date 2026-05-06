import { Img, Section } from "@react-email/components";
import { BRANDING } from "@/lib/branding";

function resolveLogoUrl(): string {
  const base = (process.env.NEXT_PUBLIC_URL ?? "").replace(/\/$/, "");
  const logoPath =
    process.env.NEXT_PUBLIC_FIRM_LOGO_URL ?? "/aquarius-logo.jpg";
  if (/^https?:\/\//i.test(logoPath)) return logoPath;
  return `${base}${logoPath.startsWith("/") ? "" : "/"}${logoPath}`;
}

export function Logo() {
  const src = resolveLogoUrl();
  return (
    <Section style={{ textAlign: "center", padding: "0 0 24px" }}>
      <Img
        src={src}
        alt={BRANDING.firmName}
        width="180"
        height="auto"
        style={{
          display: "inline-block",
          height: "auto",
          maxWidth: "180px",
          border: 0,
          outline: "none",
          textDecoration: "none",
        }}
      />
    </Section>
  );
}
