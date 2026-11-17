"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { useLocale } from "@/shared/lib/locale-context";

export function RegisterForm() {
  const { t } = useLocale();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload = {
      name: String(fd.get("name") || ""),
      email: String(fd.get("email")),
      password: String(fd.get("password")),
    };
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.status === 409) {
      setError(t.auth.exists);
      setLoading(false);
      return;
    }
    if (!res.ok) {
      setError(t.auth.error);
      setLoading(false);
      return;
    }
    const login = await signIn("credentials", {
      email: payload.email,
      password: payload.password,
      redirect: false,
    });
    setLoading(false);
    if (login?.ok) router.push("/day");
    else setError(t.auth.error);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 w-full max-w-sm">
      <h1 className="font-display text-3xl">{t.auth.registerTitle}</h1>
      <label className="block space-y-1.5">
        <span className="text-xs text-muted">{t.auth.name}</span>
        <input name="name" className="field" />
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs text-muted">{t.auth.email}</span>
        <input name="email" type="email" required className="field" />
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs text-muted">{t.auth.password}</span>
        <input name="password" type="password" required minLength={6} className="field" />
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={loading}>
        {t.auth.registerBtn}
      </button>
      <p className="text-sm text-muted">
        {t.auth.hasAccount}{" "}
        <Link href="/login" className="text-accent underline-offset-2 hover:underline">
          {t.ctaLogin}
        </Link>
      </p>
    </form>
  );
}
