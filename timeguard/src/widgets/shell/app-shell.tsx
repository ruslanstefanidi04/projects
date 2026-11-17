"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { motion } from "framer-motion";
import {
  CalendarDays,
  CalendarRange,
  StickyNote,
  ListTodo,
  Timer,
  Settings,
  LogOut,
  KeyRound,
  Wallet,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useEffect, useRef } from "react";
import { useLocale } from "@/shared/lib/locale-context";

const links = [
  { href: "/day", key: "day" as const, icon: CalendarDays },
  { href: "/month", key: "month" as const, icon: CalendarRange },
  { href: "/notes", key: "notes" as const, icon: StickyNote },
  { href: "/tasks", key: "tasks" as const, icon: ListTodo },
  { href: "/pomodoro", key: "pomodoro" as const, icon: Timer },
  { href: "/vault", key: "vault" as const, icon: KeyRound },
  { href: "/finance", key: "finance" as const, icon: Wallet },
  { href: "/settings", key: "settings" as const, icon: Settings },
];

const mobileLinks = links.filter((item) => item.key !== "settings");

function MobileNav({
  pathname,
  labels,
}: {
  pathname: string;
  labels: Record<(typeof links)[number]["key"], string>;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv || !ref.current) return;
    const pin = () => {
      const el = ref.current;
      if (!el) return;
      const gap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      el.style.transform = gap ? `translateY(-${gap}px)` : "";
    };
    pin();
    vv.addEventListener("resize", pin);
    vv.addEventListener("scroll", pin);
    window.addEventListener("orientationchange", pin);
    return () => {
      vv.removeEventListener("resize", pin);
      vv.removeEventListener("scroll", pin);
      window.removeEventListener("orientationchange", pin);
    };
  }, []);

  return (
    <nav
      ref={ref}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-edge bg-panel pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="flex h-[4.75rem]">
        {mobileLinks.map(({ href, key, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
              <Link
              key={href}
              href={href}
              prefetch
              aria-label={labels[key]}
              className={cn(
                "flex flex-1 items-center justify-center",
                active ? "text-accent" : "text-muted",
              )}
            >
              <Icon className="size-6" />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useLocale();
  const { data } = useSession();

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <aside className="md:w-60 md:h-screen md:sticky md:top-0 z-20 border-b md:border-b-0 md:border-r border-edge bg-panel/80 backdrop-blur-md flex flex-col">
        <div className="flex items-center justify-between gap-3 px-4 py-3 md:block md:px-5 md:py-5">
          <Link href="/day" className="group block">
            <div className="font-display text-xl tracking-[0.18em] text-ink">
              {t.brand}
            </div>
          </Link>
          <div className="flex items-center gap-2 md:hidden">
            <Link
              href="/settings"
              aria-label={t.nav.settings}
              className={cn(
                "inline-flex size-11 items-center justify-center rounded-xl border",
                pathname.startsWith("/settings")
                  ? "border-accent/40 text-accent"
                  : "border-edge text-muted",
              )}
            >
              <Settings className="size-5" />
            </Link>
            <button
              type="button"
              aria-label={t.nav.logout}
              onClick={() => signOut({ callbackUrl: "/" })}
              className="inline-flex size-11 items-center justify-center rounded-xl border border-edge text-muted"
            >
              <LogOut className="size-5" />
            </button>
          </div>
        </div>

        <nav className="hidden md:flex md:flex-col gap-1 px-2 pb-3 md:overflow-y-auto md:flex-1">
          {links.map(({ href, key, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                prefetch
                className={cn(
                  "relative flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors whitespace-nowrap",
                  active
                    ? "text-ink"
                    : "text-muted hover:text-ink hover:bg-surface",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute inset-0 rounded-lg bg-accent/15 border border-accent/30"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                <Icon className="relative size-4" />
                <span className="relative">{t.nav[key]}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto hidden md:block px-3 py-4 border-t border-edge space-y-3">
          <div className="px-1 text-xs text-muted truncate" title={data?.user?.email ?? undefined}>
            {data?.user?.email}
          </div>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/" })}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-edge px-3 py-2.5 text-sm text-muted transition hover:bg-surface hover:text-ink"
          >
            <LogOut className="size-4" />
            {t.nav.logout}
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 p-4 pb-28 md:p-8">{children}</main>
      <MobileNav pathname={pathname} labels={t.nav} />
    </div>
  );
}
