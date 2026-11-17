import type { Metadata } from "next";
import { Syne, DM_Sans, JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { Providers } from "@/shared/lib/providers";
import { isLocale, type Locale } from "@/shared/i18n";
import "./globals.css";

const display = Syne({
  subsets: ["latin"],
  variable: "--font-display",
});

const sans = DM_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-sans",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0e12" },
  ],
};

export const metadata: Metadata = {
  applicationName: "TIMEGUARD",
  title: {
    default: "TIMEGUARD",
    template: "%s · TIMEGUARD",
  },
  description:
    "TIMEGUARD - time patrol for day/week schedules, notes, and customizable Pomodoro.",
  appleWebApp: {
    capable: true,
    title: "TIMEGUARD",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
  robots: {
    index: process.env.NEXT_PUBLIC_SITE_URL?.includes("vercel.app") === false,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const raw = cookies().get("tg_locale")?.value ?? "ru";
  const locale: Locale = isLocale(raw) ? raw : "ru";

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className={`${display.variable} ${sans.variable} ${mono.variable} font-sans antialiased`}
      >
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
