"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user, pass })
    });
    setBusy(false);
    if (!r.ok) {
      setErr("Неверный логин или пароль");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="wrap">
      <div className="card login-box">
        <div className="brand" style={{ marginBottom: 18 }}>
          <h1>CS Farm</h1>
          <span>вход в панель</span>
        </div>
        <form onSubmit={onSubmit}>
          <div className="field">
            <label>Логин</label>
            <input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" />
          </div>
          <div className="field">
            <label>Пароль</label>
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" />
          </div>
          {err ? <p className="err">{err}</p> : null}
          <button className="btn pri" type="submit" disabled={busy}>
            {busy ? "..." : "Войти"}
          </button>
        </form>
      </div>
    </main>
  );
}
