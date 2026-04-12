import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aquarius Lawyers — Criminal Law Assistant",
  description:
    "Get answers to your criminal law questions and book a Legal Strategy Session with Aquarius Lawyers.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full"
    >
      <body className="h-full font-body antialiased">{children}</body>
    </html>
  );
}
