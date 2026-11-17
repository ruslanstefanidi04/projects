"use client";

import Link from "next/link";
import { useLocale } from "@/shared/lib/locale-context";
import { LocaleToggle } from "./locale-toggle";

export function LandingHeader() {
  const { t } = useLocale();

  return (
    <nav className="flex items-center justify-between gap-3">
      <div className="font-display text-xl tracking-[0.2em]">{t.brand}</div>
      <div className="flex items-center gap-2">
        <LocaleToggle />
        <Link href="/register" className="btn-primary min-w-[7.5rem]">
          {t.ctaRegister}
        </Link>
        <Link href="/login" className="btn-ghost min-w-[7.5rem]">
          {t.ctaLogin}
        </Link>
      </div>
    </nav>
  );
}
