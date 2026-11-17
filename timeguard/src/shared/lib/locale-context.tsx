"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getCopy, type Locale } from "@/shared/i18n";

type Ctx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: ReturnType<typeof getCopy>;
};

const LocaleContext = createContext<Ctx | null>(null);

export function LocaleProvider({
  children,
  initial,
}: {
  children: ReactNode;
  initial: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initial);
  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    document.cookie = `tg_locale=${l};path=/;max-age=31536000`;
  }, []);
  const value = useMemo(
    () => ({ locale, setLocale, t: getCopy(locale) }),
    [locale, setLocale],
  );
  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale outside provider");
  return ctx;
}
