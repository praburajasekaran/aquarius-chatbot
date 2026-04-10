import type { Metadata } from "next";
import { Rubik, Open_Sans } from "next/font/google";
import "./globals.css";

const rubik = Rubik({
  variable: "--font-rubik",
  subsets: ["latin"],
  display: "swap",
});

const openSans = Open_Sans({
  variable: "--font-open-sans",
  subsets: ["latin"],
  display: "swap",
});

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
      className={`${rubik.variable} ${openSans.variable} h-full`}
    >
      <body className="h-full font-body antialiased">{children}</body>
    </html>
  );
}
