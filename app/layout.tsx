import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ink Wave Maintenance",
  description: "Independent bilingual maintenance operations for supervisors and technicians.",
  applicationName: "Ink Wave Maintenance",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
