import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HireReady Agent",
  description: "An AI agent that tailors your CV to any job, fact-checks itself, and preps you for the interview.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
