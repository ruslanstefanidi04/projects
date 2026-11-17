"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { useLocale } from "@/shared/lib/locale-context";
import { safeInternalPath } from "@/shared/lib/safe-path";

export function LoginForm() {
  const { t } = useLocale();
  const router = useRouter();
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(false);
    const fd = new FormData(e.currentTarget);
    const res = await signIn("credentials", {
      email: String(fd.get("email")),
      password: String(fd.get("password")),
      redirect: false,
    });
    setLoading(false);
    if (res?.ok) {
      const next = safeInternalPath(
        new URLSearchParams(window.location.search).get("callbackUrl"),
      );
      router.push(next ?? "/day");
    }
    else setError(true);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 w-full max-w-sm">
      <h1 className="font-display text-3xl">{t.auth.loginTitle}</h1>
      <label className="block space-y-1.5">
        <span className="text-xs text-muted">{t.auth.email}</span>
        <input name="email" type="email" required className="field" />
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs text-muted">{t.auth.password}</span>
        <input name="password" type="password" required minLength={6} className="field" />
      </label>
      {error && <p className="text-sm text-danger">{t.auth.error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={loading}>
        {t.auth.loginBtn}
      </button>
      <p className="text-sm text-muted">
        {t.auth.noAccount}{" "}
        <Link href="/register" className="text-accent underline-offset-2 hover:underline">
          {t.ctaRegister}
        </Link>
      </p>
    </form>
  );
}
