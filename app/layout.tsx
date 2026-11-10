import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mock Interview",
  description: "Voice-based mock interview practice with an AI interviewer.",
};

export const viewport: Viewport = {
  themeColor: "#050505",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB" className={`${mono.variable} h-full antialiased`}>
      <body className="min-h-full bg-void font-mono text-neutral-200">{children}</body>
    </html>
  );
}
