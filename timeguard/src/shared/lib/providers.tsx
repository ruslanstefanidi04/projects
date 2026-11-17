"use client";

import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { LocaleProvider } from "@/shared/lib/locale-context";
import { SettingsProvider } from "@/shared/lib/settings-context";
import { StandaloneLinks } from "@/shared/lib/standalone-links";
import type { Locale } from "@/shared/i18n";
import type { ReactNode } from "react";

export function Providers({
  children,
  locale,
}: {
  children: ReactNode;
  locale: Locale;
}) {
  return (
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <LocaleProvider initial={locale}>
          <SettingsProvider>
            <StandaloneLinks />
            {children}
          </SettingsProvider>
        </LocaleProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
