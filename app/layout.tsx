import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Email Relay",
  description: "Send from the UI, let the recipient reply straight from their inbox, see the reply back in the UI.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
