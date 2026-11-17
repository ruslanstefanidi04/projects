import { en, type Copy } from "./en";
import { ru } from "./ru";

export type Locale = "en" | "ru";

const map: Record<Locale, Copy> = { en, ru };

export function getCopy(locale: Locale = "ru"): Copy {
  return map[locale] ?? ru;
}

export function isLocale(v: string): v is Locale {
  return v === "en" || v === "ru";
}
