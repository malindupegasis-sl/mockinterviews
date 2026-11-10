import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mock Interview",
  description: "Voice-based mock interview practice with an AI interviewer.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
