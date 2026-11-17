"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { InventoryGrid } from "@/ui/InventoryGrid";
import { StatusPill } from "@/ui/StatusPill";

type Acc = {
  id: string;
  login: string;
  email?: string;
  steamId: string;
  persona: string;
  avatar: string;
  status: string;
  lastError: string;
  matchKind: string;
  connectHost: string;
  steamPath: string;
  ipcName: string;
  fpsCap: number;
  enabled: boolean;
  network: { steamOk: boolean; pingMs: number | null; inGame: boolean };
  inventory: { assetId: string; name: string; type: string; icon: string; rarity: string }[];
  inventoryAt: number;
  tradeNote?: string;
  hasIdentity?: boolean;
};

export default function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState("");
  const [a, setA] = useState<Acc | null>(null);
  const [busy, setBusy] = useState(false);
  const [identitySecret, setIdentitySecret] = useState("");

  useEffect(() => {
    params.then((p) => setId(p.id));
  }, [params]);

  async function load(nextId = id) {
    if (!nextId) return;
    const r = await fetch(`/api/accounts/${nextId}`, { cache: "no-store" });
    if (!r.ok) return;
    const j = (await r.json()) as { account: Acc };
    setA(j.account);
  }

  useEffect(() => {
    if (!id) return;
    load(id);
  }, [id]);

  async function inv() {
    setBusy(true);
    await fetch(`/api/accounts/${id}/inventory`);
    await load();
    setBusy(false);
  }

  async function cmd(kind: string) {
    await fetch(`/api/accounts/${id}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind })
    });
    await load();
  }

  async function save() {
    if (!a) return;
    await fetch(`/api/accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        steamId: a.steamId,
        email: a.email,
        steamPath: a.steamPath,
        ipcName: a.ipcName,
        matchKind: a.matchKind,
        connectHost: a.connectHost,
        fpsCap: a.fpsCap,
        enabled: a.enabled,
        identitySecret: identitySecret || undefined
      })
    });
    await load();
  }

  async function remove() {
    await fetch(`/api/accounts/${id}`, { method: "DELETE" });
    location.href = "/";
  }

  if (!a) return <main className="wrap"><p className="muted">Загрузка...</p></main>;

  return (
    <main className="wrap">
      <div className="top">
        <div className="brand">
          <h1>{a.persona || a.login}</h1>
          <span>{a.login}{a.email ? ` · ${a.email}` : ""} · {a.steamId}</span>
        </div>
        <div className="row">
          <Link className="btn" href="/">Назад</Link>
          <button className="btn pri" onClick={() => cmd("launch")}>Старт</button>
          <button className="btn" onClick={() => cmd("queue")}>Матч</button>
          <button className="btn" onClick={() => cmd("sendVault")}>На общий</button>
          <button className="btn" onClick={() => cmd("acceptTrades")}>Принять</button>
          <button className="btn" onClick={() => cmd("stop")}>Стоп</button>
          <button className="btn danger" onClick={remove}>Удалить</button>
        </div>
      </div>
      <div className="acc-head" style={{ marginBottom: 18 }}>
        {a.avatar ? <img src={a.avatar} alt="" /> : null}
        <div>
          <div className="row">
            <StatusPill status={a.status} />
            <span className="pill">сеть {a.network.pingMs ?? "–"} ms</span>
            <span className="pill">{a.network.inGame ? "в игре" : "не в матче"}</span>
            {a.tradeNote ? <span className="pill">{a.tradeNote}</span> : null}
          </div>
          {a.lastError ? <p className="err">{a.lastError}</p> : null}
        </div>
      </div>
      <section className="card" style={{ marginBottom: 18 }}>
        <div className="form-grid">
          <div className="field"><label>Почта</label><input value={a.email || ""} onChange={(e) => setA({ ...a, email: e.target.value })} /></div>
          <div className="field"><label>SteamID64</label><input value={a.steamId} onChange={(e) => setA({ ...a, steamId: e.target.value })} /></div>
          <div className="field"><label>Steam.exe</label><input value={a.steamPath} onChange={(e) => setA({ ...a, steamPath: e.target.value })} /></div>
          <div className="field"><label>IPC</label><input value={a.ipcName} onChange={(e) => setA({ ...a, ipcName: e.target.value })} /></div>
          <div className="field"><label>Connect</label><input value={a.connectHost} onChange={(e) => setA({ ...a, connectHost: e.target.value })} /></div>
          <div className="field">
            <label>Матч</label>
            <select value={a.matchKind} onChange={(e) => setA({ ...a, matchKind: e.target.value })}>
              <option value="competitive">Competitive</option>
              <option value="premier">Premier</option>
              <option value="wingman">Wingman</option>
              <option value="deathmatch">Deathmatch</option>
              <option value="casual">Casual</option>
            </select>
          </div>
          <div className="field"><label>FPS cap</label><input type="number" value={a.fpsCap} onChange={(e) => setA({ ...a, fpsCap: Number(e.target.value) || 20 })} /></div>
          <div className="field"><label>Identity secret {a.hasIdentity ? "(уже есть)" : ""}</label><input value={identitySecret} onChange={(e) => setIdentitySecret(e.target.value)} placeholder="оставить пустым если не менять" /></div>
        </div>
        <div className="row">
          <button className="btn pri" onClick={save}>Сохранить</button>
          <button className="btn" onClick={inv} disabled={busy}>{busy ? "..." : "Обновить инвентарь"}</button>
        </div>
      </section>
      <section className="card">
        <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>Инвентарь CS2</h2>
        <p className="muted">{a.inventoryAt ? new Date(a.inventoryAt).toLocaleString() : "ещё не грузили"}</p>
        <InventoryGrid items={a.inventory || []} />
      </section>
    </main>
  );
}
