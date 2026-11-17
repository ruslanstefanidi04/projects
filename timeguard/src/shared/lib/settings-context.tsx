"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import { ACCENTS, type AccentKey } from "@/shared/config/theme";
import { useLocale } from "./locale-context";
import { readScreenCache, writeScreenCache } from "./screen-cache";
import type { Locale } from "@/shared/i18n";

export type UserSettings = {
  theme: string;
  locale: string;
  accent: AccentKey;
  density: "comfortable" | "compact";
  weekStartsOn: 0 | 1;
  pomodoroFocus: number;
  pomodoroBreak: number;
  pomodoroLong: number;
  pomodoroCycles: number;
  soundEnabled: boolean;
  baseCurrency: string;
};

const defaults: UserSettings = {
  theme: "system",
  locale: "ru",
  accent: "teal",
  density: "comfortable",
  weekStartsOn: 1,
  pomodoroFocus: 25,
  pomodoroBreak: 5,
  pomodoroLong: 15,
  pomodoroCycles: 4,
  soundEnabled: true,
  baseCurrency: "USD",
};

type Ctx = {
  settings: UserSettings;
  loading: boolean;
  save: (patch: Partial<UserSettings>) => Promise<void>;
  refresh: () => Promise<void>;
};

const SettingsContext = createContext<Ctx | null>(null);

function applyAccent(accent: AccentKey) {
  const a = ACCENTS[accent] ?? ACCENTS.teal;
  document.documentElement.style.setProperty("--accent", a.hsl);
  document.documentElement.dataset.accent = accent;
}

const SETTINGS_KEY = "tg-settings-v1";

function applySettings(next: UserSettings, setTheme: (theme: string) => void, setLocale: (locale: Locale) => void) {
  setTheme(next.theme);
  setLocale(next.locale as Locale);
  applyAccent(next.accent);
  document.documentElement.dataset.density = next.density;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const { setTheme } = useTheme();
  const { setLocale } = useLocale();
  const [settings, setSettings] = useState<UserSettings>(
    () => readScreenCache<UserSettings>(SETTINGS_KEY) ?? defaults,
  );
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (status !== "authenticated") return;
    setLoading(true);
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) return;
      const { settings: s } = await res.json();
      const next: UserSettings = {
        theme: s.theme,
        locale: s.locale,
        accent: (s.accent as AccentKey) || "teal",
        density: s.density === "compact" ? "compact" : "comfortable",
        weekStartsOn: s.weekStartsOn === 0 ? 0 : 1,
        pomodoroFocus: s.pomodoroFocus,
        pomodoroBreak: s.pomodoroBreak,
        pomodoroLong: s.pomodoroLong,
        pomodoroCycles: s.pomodoroCycles,
        soundEnabled: s.soundEnabled,
        baseCurrency: typeof s.baseCurrency === "string" ? s.baseCurrency : "USD",
      };
      setSettings(next);
      writeScreenCache(SETTINGS_KEY, next);
      applySettings(next, setTheme, setLocale);
    } finally {
      setLoading(false);
    }
  }, [status, setTheme, setLocale]);

  useLayoutEffect(() => {
    const cached = readScreenCache<UserSettings>(SETTINGS_KEY);
    if (!cached) return;
    setSettings(cached);
    applySettings(cached, setTheme, setLocale);
  }, [setTheme, setLocale]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (patch: Partial<UserSettings>) => {
      const next = { ...settings, ...patch };
      setSettings(next);
      writeScreenCache(SETTINGS_KEY, next);
      if (patch.theme) setTheme(patch.theme);
      if (patch.locale) setLocale(patch.locale as Locale);
      if (patch.accent) applyAccent(patch.accent);
      if (patch.density) document.documentElement.dataset.density = patch.density;
      if (status !== "authenticated") return;
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    },
    [settings, setTheme, setLocale, status],
  );

  const value = useMemo(
    () => ({ settings, loading, save, refresh }),
    [settings, loading, save, refresh],
  );

  return (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings outside provider");
  return ctx;
}
