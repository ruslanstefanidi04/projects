"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { useLocale } from "@/shared/lib/locale-context";
import { useSettings, type UserSettings } from "@/shared/lib/settings-context";
import { CURRENCIES, currencyLabel } from "@/shared/lib/currencies";
import { ACCENTS, type AccentKey } from "@/shared/config/theme";
import { SelectMenu } from "@/shared/ui/select-menu";
import type { Locale } from "@/shared/i18n";

type NumKey =
  | "pomodoroFocus"
  | "pomodoroBreak"
  | "pomodoroLong"
  | "pomodoroCycles";

function NumberField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  return (
    <label className="block space-y-1.5">
      <span className="text-xs text-muted">{label}</span>
      <input
        type="number"
        className="field"
        min={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = Number.parseInt(text, 10);
          const next = Number.isFinite(n) && n >= 1 ? n : 1;
          setText(String(next));
          onCommit(next);
        }}
      />
    </label>
  );
}

export function SettingsBoard() {
  const { t } = useLocale();
  const { settings, save } = useSettings();
  const { setTheme } = useTheme();
  const [saved, setSaved] = useState(false);
  const [cleared, setCleared] = useState<string | null>(null);

  async function clearData(kind: "week" | "finance") {
    const ok = window.confirm(
      kind === "week" ? t.settings.confirmClearWeek : t.settings.confirmClearFinance,
    );
    if (!ok) return;
    const res = await fetch(kind === "week" ? "/api/blocks" : "/api/finance", {
      method: "DELETE",
    });
    if (!res.ok) return;
    setCleared(kind);
    window.setTimeout(() => setCleared(null), 1600);
  }

  async function persist() {
    await save(settings);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  }

  const pomoFields: { key: NumKey; label: string }[] = [
    { key: "pomodoroFocus", label: t.settings.focusMin },
    { key: "pomodoroBreak", label: t.settings.breakMin },
    { key: "pomodoroLong", label: t.settings.longMin },
    { key: "pomodoroCycles", label: t.settings.cycles },
  ];

  const loc = settings.locale === "en" ? "en-US" : "ru-RU";

  return (
    <div className="mx-auto w-full max-w-xl space-y-8">
      <header className="text-center">
        <p className="text-xs uppercase tracking-[0.28em] text-muted">
          {t.settings.title}
        </p>
        <h1 className="font-display text-3xl md:text-4xl mt-1">
          {t.settings.title}
        </h1>
      </header>

      <section className="rounded-2xl border border-edge bg-panel/70 p-5 space-y-5 shadow-soft">
        <h2 className="font-display text-lg text-center">{t.settings.appearance}</h2>

        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t.settings.theme}</span>
          <SelectMenu
            ariaLabel={t.settings.theme}
            value={settings.theme}
            onChange={(theme) => {
              setTheme(theme);
              void save({ theme });
            }}
            options={[
              { value: "system", label: t.settings.themeSystem },
              { value: "light", label: t.settings.themeLight },
              { value: "dark", label: t.settings.themeDark },
            ]}
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t.settings.locale}</span>
          <SelectMenu
            ariaLabel={t.settings.locale}
            value={settings.locale}
            onChange={(locale) => void save({ locale: locale as Locale })}
            options={[
              { value: "ru", label: "Русский" },
              { value: "en", label: "English" },
            ]}
          />
        </label>

        <div className="space-y-1.5">
          <span className="text-xs text-muted">{t.settings.accent}</span>
          <div className="flex flex-wrap justify-center gap-2">
            {(Object.keys(ACCENTS) as AccentKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => void save({ accent: key })}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                  settings.accent === key
                    ? "border-accent bg-accent/10"
                    : "border-edge"
                }`}
              >
                <span
                  className="size-3 rounded-full"
                  style={{ background: ACCENTS[key].hex }}
                />
                {t.accents[key]}
              </button>
            ))}
          </div>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t.settings.density}</span>
          <SelectMenu
            ariaLabel={t.settings.density}
            value={settings.density}
            onChange={(density) =>
              void save({
                density: density as "comfortable" | "compact",
              })
            }
            options={[
              { value: "comfortable", label: t.settings.densityComfortable },
              { value: "compact", label: t.settings.densityCompact },
            ]}
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t.settings.weekStartsOn}</span>
          <SelectMenu
            ariaLabel={t.settings.weekStartsOn}
            value={String(settings.weekStartsOn)}
            onChange={(value) =>
              void save({ weekStartsOn: Number(value) as 0 | 1 })
            }
            options={[
              { value: "1", label: t.settings.monday },
              { value: "0", label: t.settings.sunday },
            ]}
          />
        </label>
      </section>

      <section className="rounded-2xl border border-edge bg-panel/70 p-5 space-y-4 shadow-soft">
        <h2 className="font-display text-lg text-center">{t.settings.finance}</h2>
        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t.settings.currency}</span>
          <SelectMenu
            ariaLabel={t.settings.currency}
            value={settings.baseCurrency}
            onChange={(baseCurrency) => void save({ baseCurrency })}
            options={CURRENCIES.map((code) => ({
              value: code,
              label: currencyLabel(code, loc),
            }))}
          />
        </label>
        <p className="text-xs text-muted text-center">{t.settings.currencyHint}</p>
      </section>

      <section className="rounded-2xl border border-edge bg-panel/70 p-5 space-y-4 shadow-soft">
        <h2 className="font-display text-lg text-center">{t.settings.pomodoro}</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {pomoFields.map(({ key, label }) => (
            <NumberField
              key={key}
              label={label}
              value={settings[key]}
              onCommit={(n) => void save({ [key]: n } as Partial<UserSettings>)}
            />
          ))}
        </div>
        <label className="flex items-center justify-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={settings.soundEnabled}
            onChange={(e) => void save({ soundEnabled: e.target.checked })}
          />
          {t.settings.sound}
        </label>
      </section>

      <section className="rounded-2xl border border-danger/30 bg-panel/70 p-5 space-y-4 shadow-soft">
        <h2 className="font-display text-lg text-center">{t.settings.data}</h2>
        <div className="space-y-2 text-center">
          <button
            type="button"
            className="btn-danger w-full"
            onClick={() => void clearData("week")}
          >
            {t.settings.clearWeek}
          </button>
          <p className="text-xs text-muted">{t.settings.clearWeekHint}</p>
        </div>
        <div className="space-y-2 text-center">
          <button
            type="button"
            className="btn-danger w-full"
            onClick={() => void clearData("finance")}
          >
            {t.settings.clearFinance}
          </button>
          <p className="text-xs text-muted">{t.settings.clearFinanceHint}</p>
        </div>
        {cleared && (
          <p className="text-center text-sm text-accent">{t.settings.cleared}</p>
        )}
      </section>

      <div className="flex items-center justify-center gap-3">
        <button type="button" className="btn-primary" onClick={() => void persist()}>
          {t.settings.save}
        </button>
        {saved && <span className="text-sm text-accent">{t.settings.saved}</span>}
      </div>
    </div>
  );
}
