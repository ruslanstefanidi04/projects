"use client";

import { useRouter } from "next/navigation";
import { useLocale } from "@/shared/lib/locale-context";
import { useSettings } from "@/shared/lib/settings-context";
import type { Locale } from "@/shared/i18n";
import { cn } from "@/shared/lib/utils";
import { useSession } from "next-auth/react";

export function LocaleToggle({ className }: { className?: string }) {
  const { t, locale, setLocale } = useLocale();
  const { status } = useSession();
  const settings = useSettings();
  const router = useRouter();

  function switchLocale(next: Locale) {
    if (next === locale) return;
    setLocale(next);
    if (status === "authenticated") {
      void settings.save({ locale: next });
    }
    router.refresh();
  }

  return (
    <div
      className={cn(
        "inline-flex h-10 items-center rounded-xl border border-edge bg-panel/50 p-0.5",
        className,
      )}
      role="group"
      aria-label={t.settings.locale}
    >
      <button
        type="button"
        onClick={() => switchLocale("ru")}
        className={cn(
          "h-9 min-w-10 rounded-[10px] px-2.5 text-xs font-medium tracking-wide transition",
          locale === "ru" ? "bg-accent text-white" : "text-muted hover:text-ink",
        )}
      >
        {t.langRu}
      </button>
      <button
        type="button"
        onClick={() => switchLocale("en")}
        className={cn(
          "h-9 min-w-10 rounded-[10px] px-2.5 text-xs font-medium tracking-wide transition",
          locale === "en" ? "bg-accent text-white" : "text-muted hover:text-ink",
        )}
      >
        {t.langEn}
      </button>
    </div>
  );
}
