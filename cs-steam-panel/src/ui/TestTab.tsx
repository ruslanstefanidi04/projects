"use client";

import { useEffect, useState } from "react";
import { StatusPill } from "./StatusPill";
import type { AccView } from "./AccountCard";

function ModeSelect({
  value,
  onChange,
  disabled
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="field" style={{ minWidth: 180, margin: 0 }}>
      <label>Режим</label>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="deathmatch">Deathmatch</option>
        <option value="competitive">ММ</option>
        <option value="premier">Premier</option>
        <option value="casual">Casual</option>
        <option value="wingman">Wingman</option>
      </select>
    </div>
  );
}

export function TestTab({
  accounts,
  botNote,
  cycleRunning,
  botEnabled,
  id,
  onId,
  onLoad
}: {
  accounts: AccView[];
  botNote: string;
  cycleRunning: boolean;
  botEnabled: boolean;
  id: string;
  onId: (v: string) => void;
  onLoad: () => Promise<void>;
}) {
  const tests = accounts.filter((x) => x.testOnly);
  const pool = accounts;
  const a = pool.find((x) => x.id === id) || pool[0] || null;
  const live = Boolean(a?.workerAt && Date.now() - a.workerAt < 45000);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [steamId, setSteamId] = useState("");
  const [sharedSecret, setShared] = useState("");
  const [steamPath, setPath] = useState("");
  const [email, setEmail] = useState("");
  const [mailEdit, setMailEdit] = useState("");
  const [editLogin, setEditLogin] = useState("");
  const [editPass, setEditPass] = useState("");
  const [editSteamId, setEditSteamId] = useState("");
  const [editSecret, setEditSecret] = useState("");
  const [editPath, setEditPath] = useState("");
  const [guardCode, setGuardCode] = useState("");
  const [newKind, setNewKind] = useState("deathmatch");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const running = Boolean(busy || (a && ["starting", "cs2", "queued", "ingame"].includes(a.status)));
  const mode = a?.matchKind || "deathmatch";

  useEffect(() => {
    setMailEdit(a?.email || "");
    setEditLogin(a?.login || "");
    setEditPass("");
    setEditSteamId(a?.steamId || "");
    setEditSecret("");
    setEditPath(a?.steamPath || "");
  }, [a?.id, a?.email, a?.login, a?.steamId, a?.steamPath]);

  async function cmd(kind: string) {
    if (!a || busy) return;
    setBusy(true);
    setErr("");
    try {
      if (kind === "test") {
        await fetch(`/api/accounts/${a.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ testOnly: true, warmupDone: true, warmupUntil: 0 })
        });
      }
      const r = await fetch(`/api/accounts/${a.id}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          payload:
            kind === "guard"
              ? guardCode.trim()
              : kind === "test" || kind === "queue" || kind === "connect"
              ? JSON.stringify({ matchKind: mode })
              : ""
        })
      });
      if (!r.ok) setErr("команда не ушла, обнови страницу");
      await onLoad();
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!a) return;
    setErr("");
    const body: Record<string, unknown> = {
      login: editLogin.trim(),
      email: mailEdit.trim(),
      steamId: editSteamId.trim(),
      steamPath: editPath.trim(),
      testOnly: true
    };
    if (editPass.trim()) body.password = editPass.trim();
    if (editSecret.trim()) body.sharedSecret = editSecret.trim();
    const r = await fetch(`/api/accounts/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      setErr("не сохранилось");
      return;
    }
    setEditPass("");
    setEditSecret("");
    await onLoad();
  }

  async function dropAcc() {
    if (!a) return;
    if (!window.confirm(`Удалить ${a.login}?`)) return;
    setErr("");
    const r = await fetch(`/api/accounts/${a.id}`, { method: "DELETE" });
    if (!r.ok) {
      setErr("не удалился");
      return;
    }
    onId("");
    await onLoad();
  }

  async function setMode(matchKind: string) {
    if (!a) return;
    await fetch(`/api/accounts/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchKind })
    });
    await onLoad();
  }

  async function saveTest(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const r = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        login,
        password,
        steamId,
        sharedSecret,
        steamPath,
        email,
        testOnly: true,
        matchKind: newKind
      })
    });
    if (!r.ok) {
      setErr("Не сохранился");
      return;
    }
    const j = (await r.json()) as { account?: { id: string } };
    setLogin("");
    setPassword("");
    setSteamId("");
    setShared("");
    setPath("");
    setEmail("");
    if (j.account?.id) onId(j.account.id);
    await onLoad();
  }

  return (
    <>
      <section className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>Тестовый акк</h2>
        <p className="muted">
          Только эта вкладка. Не идёт в прогрев, пачки, прокси. Можно без прокси. Нужен воркер. Старт уходит сразу, в логе за пару секунд будет cmds test. Сессия на диске воркера и в панели. Если CS уже в меню, Старт жмёт поиск.
        </p>
        {pool.length ? (
          <div className="field">
            <label>Кого гоняем</label>
            <select value={a?.id || ""} onChange={(e) => onId(e.target.value)}>
              {pool.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.login}{x.email ? ` · ${x.email}` : ""}{x.testOnly ? "" : " (не помечен тестом)"}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {!tests.length && pool.length ? <p className="muted">Флаг «тест» слетел, ниже все акки из базы. Нажми Старт, пометку вернём.</p> : null}
        {cycleRunning ? <p className="err">Цикл пачек запущен. Сначала Стоп на Аккаунтах.</p> : null}
        {!botEnabled ? <p className="err">Бот выключен в Конфиге.</p> : null}
        {!live ? <p className="muted">Воркер не стучится. На ПК со Steam: npm run worker</p> : null}
        {a ? <ModeSelect value={mode} disabled={busy} onChange={setMode} /> : null}
        <div className="row">
          <button className="btn pri" type="button" disabled={!a || cycleRunning || running} onClick={() => cmd("test")}>{running ? "Идёт запуск..." : "Старт CS"}</button>
          <button className="btn" type="button" disabled={!a || cycleRunning || busy} onClick={() => cmd("queue")}>Поиск матча</button>
          <button className="btn danger" type="button" disabled={!a} onClick={() => cmd("stop")}>Стоп</button>
        </div>
        {err ? <p className="err" style={{ marginTop: 10 }}>{err}</p> : null}
      </section>
      {a ? (
        <section className="card" style={{ marginBottom: 18 }}>
          <div className="acc-head">
            {a.avatar ? <img src={a.avatar} alt="" /> : <div style={{ width: 42, height: 42, borderRadius: 10, background: "#0f131a" }} />}
            <div>
              <h3>{a.persona || a.login}</h3>
              <p>{a.login} · {a.email || "нет почты"} · {a.steamId || "нет steamid"}</p>
            </div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <StatusPill status={a.status} />
            <span className="pill">
              <span className={`dot ${live ? "ok" : "bad"}`} />
              {live ? "воркер" : "нет воркера"}
            </span>
            <span className="pill">{a.network.inGame || a.status === "ingame" ? "в игре" : a.status === "queued" ? "поиск" : "не в матче"}</span>
            <span className="pill">только тест</span>
            <span className="pill">{a.hasSession ? "сессия Steam" : "нет сессии"}</span>
            <span className="pill">{mode === "competitive" ? "ММ" : mode === "deathmatch" ? "DM" : mode}</span>
          </div>
          <div className="form-grid" style={{ marginTop: 14 }}>
            <div className="field">
              <label>Логин</label>
              <input value={editLogin} onChange={(e) => setEditLogin(e.target.value)} />
            </div>
            <div className="field">
              <label>Пароль {a.hasPassword ? "(есть, пусто = не трогать)" : "(нет)"}</label>
              <input type="password" value={editPass} onChange={(e) => setEditPass(e.target.value)} placeholder="новый пароль" />
            </div>
            <div className="field">
              <label>Почта акка</label>
              <input value={mailEdit} onChange={(e) => setMailEdit(e.target.value)} placeholder="email для гварда" />
            </div>
            <div className="field">
              <label>SteamID64</label>
              <input value={editSteamId} onChange={(e) => setEditSteamId(e.target.value)} />
            </div>
            <div className="field">
              <label>Shared secret</label>
              <input value={editSecret} onChange={(e) => setEditSecret(e.target.value)} placeholder="пусто = не трогать" />
            </div>
            <div className="field">
              <label>Путь Steam.exe</label>
              <input value={editPath} onChange={(e) => setEditPath(e.target.value)} placeholder="C:\Program Files (x86)\Steam\steam.exe" />
            </div>
            <div className="field">
              <label>Код с почты</label>
              <input value={guardCode} onChange={(e) => setGuardCode(e.target.value)} placeholder="5 цифр" />
            </div>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" type="button" onClick={() => saveEdit()}>Сохранить правки</button>
            <button
              className="btn pri"
              type="button"
              disabled={!guardCode.trim()}
              onClick={async () => {
                if (!a) return;
                const code = guardCode.trim();
                setGuardCode("");
                await fetch(`/api/accounts/${a.id}/command`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ kind: "guard", payload: code })
                });
                await onLoad();
              }}
            >
              Ввести код
            </button>
            <button className="btn danger" type="button" onClick={() => dropAcc()}>Удалить акк</button>
          </div>
          {a.lastError ? <p className="err" style={{ marginTop: 10 }}>{a.lastError}</p> : null}
          {botNote ? <p className="muted" style={{ marginTop: 10 }}>бот: {botNote}</p> : null}
        </section>
      ) : null}
      <section className="card">
        <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>{tests.length ? "Ещё тестовый" : "Добавить тестовый акк"}</h2>
        <form onSubmit={saveTest}>
          <div className="form-grid">
            <div className="field"><label>Логин Steam</label><input value={login} onChange={(e) => setLogin(e.target.value)} required /></div>
            <div className="field"><label>Пароль</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
            <div className="field"><label>Почта</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="для Steam Guard" /></div>
            <div className="field"><label>SteamID64</label><input value={steamId} onChange={(e) => setSteamId(e.target.value)} /></div>
            <div className="field"><label>Shared secret</label><input value={sharedSecret} onChange={(e) => setShared(e.target.value)} /></div>
            <div className="field"><label>Путь Steam.exe</label><input value={steamPath} onChange={(e) => setPath(e.target.value)} placeholder="C:\Steam\steam.exe" /></div>
            <ModeSelect value={newKind} onChange={setNewKind} />
          </div>
          {err ? <p className="err">{err}</p> : null}
          <button className="btn pri" type="submit">Сохранить как тестовый</button>
        </form>
      </section>
    </>
  );
}
