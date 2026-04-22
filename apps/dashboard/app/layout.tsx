import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/src/components/Providers";
import { TerminalStatusBar } from "@/src/components/terminal-status-bar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FLUX — BaaS Orchestrator",
  description:
    "Postgres + PostgREST. Isolated, Hashed, and Deterministic. Built for the technical elite.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-zinc-950 text-zinc-400">
        <Providers>
          <TerminalStatusBar />
          {children}
        </Providers>
      </body>
    </html>
  );
}
