import type { Metadata } from "next";
import { Besley, DM_Mono, Instrument_Sans } from "next/font/google";
import "./globals.css";

import { webRuntimeEnv } from "@/lib/runtime-env";

// Besley for titles, Instrument Sans for everything you read, DM Mono for
// figures and small labels. See .interface-design/system.md.
const besley = Besley({ subsets: ["latin"], variable: "--font-besley" });
const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument-sans",
});
const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-dm-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL(webRuntimeEnv.appUrl),
  title: "GreenRoster",
  description: "Golf rounds, scoring, results, quotas, and standings.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${besley.variable} ${instrumentSans.variable} ${dmMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
