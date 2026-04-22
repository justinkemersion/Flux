import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/src/components/Providers";
import { WorkspaceHeader } from "@/src/components/workspace-header";
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
  metadataBase: new URL("https://flux.vsl-base.com"),
  title: "Flux — Postgres and API per project",
  description:
    "Spin up PostgreSQL 16 and PostgREST per project. Secure auth, instant REST API, CLI-friendly.",
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
      <body className="flex min-h-full flex-col bg-zinc-50 font-sans text-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        <Providers>
          <WorkspaceHeader />
          {children}
        </Providers>
      </body>
    </html>
  );
}
