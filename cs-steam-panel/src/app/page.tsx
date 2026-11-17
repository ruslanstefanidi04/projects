"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AccountCard, type AccView } from "@/ui/AccountCard";
import { Header } from "@/ui/Header";
import { TestTab } from "@/ui/TestTab";
import { WarmupTab } from "@/ui/WarmupTab";
import { sleepJitter } from "@/lib/pace";

type Form = {
  login: string;
  password: string;
  steamId: string;
  sharedSecret: string;
  steamPath: string;
  ipcName: string;
  matchKind: string;
  connectHost: string;
  identitySecret: string;
  email: string;
  proxy: string;
};

const empty: Form = {
  login: "",
  password: "",
  steamId: "",
  sharedSecret: "",
  steamPath: "",
  ipcName: "",
  matchKind: "competitive",
  connectHost: "",
  identitySecret: "",
  email: "",
  proxy: ""
};

type Settings = {
  botEnabled: boolean;
  botNote: string;
  autoMatch: boolean;
  batchSize: number;
  passTarget: number;
  cycleRunning: boolean;
  proxyPerGroup: number;
  warmupEnabled: boolean;
};

type ProxyRow = {
  id: string;
  raw: string;
  maxSlots: number;
  hint: string;
  used: number;
};

export default function HomePage() {
  const [tab, setTab] = useState<"play" | "test" | "warmup" | "proxies" | "config">("play");
  const [testId, setTestId] = useState("");
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const [accounts, setAccounts] = useState<AccView[]>([]);
  const [form, setForm] = useState<Form>(empty);
  const [err, setErr] = useState("");
  const [bulk, setBulk] = useState("");
  const [proxyText, setProxyText] = useState("");
  const [proxies, setProxies] = useState<ProxyRow[]>([]);
  const [unbound, setUnbound] = useState(0);
  const [settings, setSettings] = useState<Settings>({
    botEnabled: true,
    botNote: "",
    autoMatch: true,
    batchSize: 5,
    passTarget: 14,
    cycleRunning: false,
    proxyPerGroup: 5,
    warmupEnabled: true
  });

  async function load() {
    const r = await fetch("/api/accounts", { cache: "no-store" });
    if (!r.ok) return;
    const j = (await r.json()) as {
      accounts: AccView[];
      settings?: Settings;
    };
    setAccounts((prev) => {
      if ((!j.accounts || !j.accounts.length) && prev.length) return prev;
      return j.accounts || [];
    });
    if (j.settings) setSettings((s) => ({ ...s, ...j.settings }));
    const pr = await fetch("/api/proxies", { cache: "no-store" });
    if (pr.ok) {
      const pj = (await pr.json()) as { proxies: ProxyRow[]; unbound: number };
      setProxies(pj.proxies || []);
      setUnbound(pj.unbound || 0);
    }
  }

  useEffect(() => {
    let stop = false;
    (async () => {
      while (!stop) {
        await load();
        if (tabRef.current === "test") await sleepJitter(2500, 4500);
        else await sleepJitter(11000, 19000);
      }
    })();
    return () => {
      stop = true;
    };
  }, []);

  async function addOne(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const r = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    if (!r.ok) {
      setErr("Не удалось добавить аккаунт");
      return;
    }
    setForm(empty);
    await load();
  }

  async function addBulk() {
    setErr("");
    const lines = bulk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const p = line.split(/[:;\t ]+/);
      if (p.length < 2) continue;
      await sleepJitter(350, 1100);
      const hasMail = (p[2] || "").includes("@");
      await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          login: p[0],
          password: p[1],
          email: hasMail ? p[2] : "",
          steamId: hasMail ? p[3] || "" : p[2] || "",
          sharedSecret: hasMail ? p[4] || "" : p[3] || "",
          identitySecret: hasMail ? p[5] || "" : p[4] || "",
          proxy: hasMail ? p[6] || "" : p[5] || ""
        })
      });
    }
    setBulk("");
    await load();
  }

  async function dropAcc(id: string) {
    if (!window.confirm("Удалить аккаунт?")) return;
    await fetch(`/api/accounts/${id}`, { method: "DELETE" });
    await load();
  }

  async function claim(id: string) {
    await fetch(`/api/accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rewardsClaimed: true, passDone: true })
    });
    await load();
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    const per = Math.min(5, Math.max(1, Number(settings.proxyPerGroup) || 5));
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...settings, proxyPerGroup: per, batchSize: per })
    });
    await load();
  }

  async function addProxies() {
    setErr("");
    const r = await fetch("/api/proxies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: proxyText })
    });
    if (!r.ok) {
      setErr("Не удалось сохранить прокси");
      return;
    }
    setProxyText("");
    await load();
  }

  async function assignProxies() {
    setErr("");
    const r = await fetch("/api/proxies/assign", { method: "POST" });
    if (!r.ok) {
      setErr("Не удалось раскидать");
      return;
    }
    await load();
  }

  async function dropProxy(id: string) {
    await fetch(`/api/proxies/${id}`, { method: "DELETE" });
    await load();
  }

  async function startCycle() {
    await fetch("/api/cycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ running: true })
    });
    await load();
  }

  async function stopCycle() {
    await fetch("/api/cycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ running: false })
    });
    await load();
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    location.href = "/login";
  }

  const live = useMemo(
    () => accounts.filter((a) => a.workerAt && Date.now() - a.workerAt < 45000).length,
    [accounts]
  );
  const ingame = accounts.filter((a) => a.status === "ingame" || a.network.inGame || a.status === "queued").length;
  const sorted = useMemo(() => {
    return [...accounts]
      .filter((a) => !a.testOnly && (a.warmupDone || !a.warmupUntil || Number(a.warmupUntil) <= Date.now()))
      .sort((a, b) => {
      const ac = a.rewardsClaimed ? 1 : 0;
      const bc = b.rewardsClaimed ? 1 : 0;
      if (ac !== bc) return ac - bc;
      const ad = a.passDone ? 1 : 0;
      const bd = b.passDone ? 1 : 0;
      if (ad !== bd) return bd - ad;
      return (b.passMatches || 0) - (a.passMatches || 0);
    });
  }, [accounts]);
  const left = accounts.filter((a) => a.enabled && !a.testOnly && !a.rewardsClaimed && !a.passDone && (a.warmupDone || !a.warmupUntil || Number(a.warmupUntil) <= Date.now())).length;
  const claimedN = accounts.filter((a) => !a.testOnly && (a.rewardsClaimed || a.passDone)).length;
  const warmupCount = accounts.filter((a) => !a.testOnly && !a.warmupDone && Number(a.warmupUntil) > Date.now()).length;

  useEffect(() => {
    const pool = accounts;
    if (!testId && pool[0]) setTestId(pool[0].id);
    if (testId && pool.length && !pool.some((x) => x.id === testId)) setTestId(pool[0].id);
  }, [accounts, testId]);

  return (
    <main className="wrap">
      <Header
        tab={tab}
        onTab={setTab}
        onStart={startCycle}
        onStop={stopCycle}
        onLogout={logout}
        running={Boolean(settings.cycleRunning)}
        warmupCount={warmupCount}
      />
      {tab === "play" ? (
        <>
          <section className="stats">
            <div className="card stat"><div className="k">В работе</div><div className="v">{left}</div></div>
            <div className="card stat"><div className="k">Воркер</div><div className="v">{live}</div></div>
            <div className="card stat"><div className="k">Поиск / матч</div><div className="v">{ingame}</div></div>
            <div className="card stat"><div className="k">Неделя закрыта</div><div className="v">{claimedN}</div></div>
          </section>
          <p className="muted" style={{ marginTop: 0 }}>
            Старт: пачки после прогрева, одна прокси-группа (до {settings.proxyPerGroup || 5}), общий поиск. Новые акки 14 дней во вкладке Прогрев.
            {settings.botNote ? ` · ${settings.botNote}` : ""}
          </p>
          <div className="grid">
            {sorted.map((a) => (
              <AccountCard key={a.id} a={a} onClaim={claim} onDelete={dropAcc} />
            ))}
          </div>
          {!sorted.length ? <p className="muted">Нет акков на пасс. Новые сидят в Прогреве 14 дней, либо добавь в Конфиге.</p> : null}
        </>
      ) : tab === "warmup" ? (
        <WarmupTab accounts={accounts} enabled={settings.warmupEnabled !== false} onLoad={load} />
      ) : tab === "test" ? (
        <TestTab
          accounts={accounts}
          botNote={settings.botNote || ""}
          cycleRunning={Boolean(settings.cycleRunning)}
          botEnabled={settings.botEnabled !== false}
          id={testId}
          onId={setTestId}
          onLoad={load}
        />
      ) : tab === "proxies" ? (
        <>
          <section className="stats">
            <div className="card stat"><div className="k">Прокси</div><div className="v">{proxies.length}</div></div>
            <div className="card stat"><div className="k">Без IP</div><div className="v">{unbound}</div></div>
            <div className="card stat"><div className="k">Слотов на IP</div><div className="v">{settings.proxyPerGroup || 5}</div></div>
            <div className="card stat"><div className="k">Нужно IP на всех</div><div className="v">{Math.ceil(Math.max(accounts.length, 1) / (settings.proxyPerGroup || 5))}</div></div>
          </section>
          <section className="card" style={{ marginBottom: 18 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>Пул</h2>
            <p className="muted">По одному на строку: host:port:user:pass или socks5://user:pass@host:port. Раскидать вешает IP на акк один раз и больше не меняет. Уже привязанные не трогаем. Без прокси воркер не стартует Steam (не домашний IP).</p>
            <div className="field">
              <label>Вставить прокси</label>
              <textarea rows={6} value={proxyText} onChange={(e) => setProxyText(e.target.value)} />
            </div>
            <div className="row">
              <button className="btn pri" type="button" onClick={addProxies}>Добавить в пул</button>
              <button className="btn" type="button" onClick={assignProxies}>Раскидать свободные акки</button>
            </div>
            {err ? <p className="err">{err}</p> : null}
          </section>
          <div className="grid">
            {proxies.map((p) => (
              <article className="card" key={p.id}>
                <h3 style={{ margin: 0, fontSize: 15 }}>{p.hint}</h3>
                <p className="muted">{p.used} / {p.maxSlots} акков</p>
                <button className="btn danger" type="button" onClick={() => dropProxy(p.id)}>Убрать из пула</button>
              </article>
            ))}
          </div>
          {!proxies.length ? <p className="muted">Пул пустой. Вставь прокси выше.</p> : null}
        </>
      ) : (
        <>
          <section className="card" style={{ marginBottom: 18 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>Где лежит и как с компа</h2>
            <p className="muted">Панель в браузере: https://cs-steam-panel.vercel.app (логин как задавали). Код: папка cs-steam-panel на диске. С твоего ПК панель открывается как обычный сайт. Старт CS/бот/прокси крутятся только если на этом же Windows запущен `npm run worker` рядом со Steam. Без воркера кнопки Старт в облаке матчи не запустят.</p>
          </section>
          <section className="card" style={{ marginBottom: 18 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>Цикл</h2>
            <form onSubmit={saveSettings}>
              <div className="field">
                <label>
                  <input type="checkbox" checked={settings.botEnabled !== false} onChange={(e) => setSettings({ ...settings, botEnabled: e.target.checked })} />
                  {" "}Бот: бай, флешки, позиции, раскидки (GSI + input)
                </label>
              </div>
              <div className="field">
                <label>
                  <input type="checkbox" checked={settings.warmupEnabled !== false} onChange={(e) => setSettings({ ...settings, warmupEnabled: e.target.checked })} />
                  {" "}Новые акки: 14 дней прогрев (бесплатные игры + часы, CS раз в 3 дня на час)
                </label>
              </div>
              <div className="form-grid">
                <div className="field"><label>Акков на один прокси</label><input type="number" min={1} max={5} value={settings.proxyPerGroup || 5} onChange={(e) => {
                  const n = Math.min(5, Math.max(1, Number(e.target.value) || 5));
                  setSettings({ ...settings, proxyPerGroup: n, batchSize: n });
                }} /></div>
                <div className="field"><label>Матчей на неделю (пасс)</label><input type="number" min={1} max={200} value={settings.passTarget || 14} onChange={(e) => setSettings({ ...settings, passTarget: Number(e.target.value) || 14 })} /></div>
              </div>
              <p className="muted">Прокси задаются во вкладке Прокси и липнут к акку. Окна CS разные размер/место. Steam web идёт через прокси. Игровой UDP CS2 часто не слушает env: для IP в матче нужен Proxifier или PROXY_WRAPPER на steam.exe.</p>
              <button className="btn pri" type="submit">Сохранить конфиг</button>
            </form>
          </section>
          <section className="card">
            <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>Аккаунты</h2>
            <form onSubmit={addOne}>
              <div className="form-grid">
                <div className="field"><label>Логин Steam</label><input value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} required /></div>
                <div className="field"><label>Пароль</label><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
                <div className="field"><label>Почта</label><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="для Steam Guard" /></div>
                <div className="field"><label>SteamID64</label><input value={form.steamId} onChange={(e) => setForm({ ...form, steamId: e.target.value })} /></div>
                <div className="field"><label>Shared secret</label><input value={form.sharedSecret} onChange={(e) => setForm({ ...form, sharedSecret: e.target.value })} /></div>
                <div className="field"><label>Identity secret</label><input value={form.identitySecret} onChange={(e) => setForm({ ...form, identitySecret: e.target.value })} /></div>
                <div className="field"><label>Путь Steam.exe</label><input value={form.steamPath} onChange={(e) => setForm({ ...form, steamPath: e.target.value })} placeholder="C:\Steam\steam.exe" /></div>
                <div className="field"><label>IPC</label><input value={form.ipcName} onChange={(e) => setForm({ ...form, ipcName: e.target.value })} /></div>
                <div className="field"><label>Прокси</label><input value={form.proxy} onChange={(e) => setForm({ ...form, proxy: e.target.value })} placeholder="host:port:user:pass или socks5://..." /></div>
                <div className="field">
                  <label>Тип матча</label>
                  <select value={form.matchKind} onChange={(e) => setForm({ ...form, matchKind: e.target.value })}>
                    <option value="competitive">Competitive</option>
                    <option value="premier">Premier</option>
                    <option value="wingman">Wingman</option>
                    <option value="deathmatch">Deathmatch</option>
                    <option value="casual">Casual</option>
                  </select>
                </div>
              </div>
              {err ? <p className="err">{err}</p> : null}
              <button className="btn pri" type="submit">Добавить</button>
            </form>
            <div className="field" style={{ marginTop: 16 }}>
              <label>Пачка: login:pass:email:steamid:shared:identity:proxy (email можно пропустить)</label>
              <textarea rows={4} value={bulk} onChange={(e) => setBulk(e.target.value)} />
            </div>
            <button className="btn" type="button" onClick={addBulk}>Импорт</button>
          </section>
        </>
      )}
    </main>
  );
}
