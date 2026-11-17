import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { authOptions } from "@/shared/lib/auth";
import { getCopy, isLocale } from "@/shared/i18n";
import { LandingHeader } from "@/widgets/shell/landing-header";

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (session) redirect("/day");

  const raw = cookies().get("tg_locale")?.value ?? "ru";
  const t = getCopy(isLocale(raw) ? raw : "ru");

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="absolute inset-0 opacity-40 pointer-events-none">
        <div className="absolute -top-24 -left-24 size-[420px] rounded-full bg-accent/30 blur-3xl animate-pulse" />
        <div className="absolute bottom-0 right-0 size-[520px] rounded-full bg-sky-400/20 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-5xl px-6 py-10 md:py-16 flex flex-col min-h-screen">
        <LandingHeader />

        <section className="flex-1 flex flex-col justify-center py-16 md:py-24">
          <h1 className="font-display text-5xl md:text-7xl lg:text-8xl tracking-tight leading-[0.95] max-w-3xl">
            {t.brand}
          </h1>
          <p className="mt-6 text-xl md:text-2xl text-ink/80 max-w-xl text-balance">
            {t.tagline}
          </p>
          <p className="mt-4 text-muted max-w-lg text-balance">{t.landingSub}</p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link href="/register" className="btn-primary min-h-10 px-6">
              {t.ctaStart}
            </Link>
            <Link href="/login" className="btn-ghost min-h-10 px-6">
              {t.ctaLogin}
            </Link>
          </div>
        </section>

        <footer className="text-xs text-muted tracking-wide pb-4">
          TIMEGUARD · day · week · notes · pomodoro
        </footer>
      </div>
    </div>
  );
}
