import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Serif } from "next/font/google";

const landingSerif = IBM_Plex_Serif({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-landing-serif",
  display: "swap",
});

const landingSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-landing-sans",
  display: "swap",
});

const landingMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-landing-mono",
  display: "swap",
});

export default function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div
      className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable} flex min-h-full flex-1 flex-col bg-zinc-950 text-zinc-100 antialiased`}
      style={{
        fontFamily: "var(--font-landing-sans), ui-sans-serif, system-ui, sans-serif",
      }}
    >
      {children}
    </div>
  );
}
