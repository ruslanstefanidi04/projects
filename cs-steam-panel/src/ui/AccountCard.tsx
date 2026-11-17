"use client";

import Link from "next/link";
import { StatusPill } from "./StatusPill";

export type AccView = {
  id: string;
  login: string;
  steamId: string;
  persona: string;
  avatar: string;
  status: string;
  lastError: string;
  network: { steamOk: boolean; pingMs: number | null; inGame: boolean };
  workerAt: number;
  inventory: { assetId: string }[];
  enabled: boolean;
  passMatches?: number;
  rewardsClaimed?: boolean;
  passDone?: boolean;
  hasProxy?: boolean;
  proxyHint?: string;
  warmupUntil?: number;
  warmupDone?: boolean;
  warmupDayMs?: number;
  warmupDayTarget?: number;
  warmupNote?: string;
  testOnly?: boolean;
  matchKind?: string;
  email?: string;
  hasSession?: boolean;
  steamPath?: string;
  hasPassword?: boolean;
};

export function AccountCard({ a, onClaim, onDelete }: { a: AccView; onClaim: (id: string) => void; onDelete?: (id: string) => void }) {
  const live = a.workerAt && Date.now() - a.workerAt < 45000;
  const claimed = Boolean(a.rewardsClaimed);
  const status = claimed || a.passDone ? "passdone" : a.status;
  return (
    <article className="card" style={claimed ? { opacity: 0.5 } : undefined}>
      <div className="acc-head">
        {a.avatar ? <img src={a.avatar} alt="" /> : <div style={{ width: 42, height: 42, borderRadius: 10, background: "#0f131a" }} />}
        <div>
          <h3>{a.persona || a.login}</h3>
          <p>{a.login}{a.email ? ` · ${a.email}` : ""} · {a.steamId || "нет steamid"}</p>
        </div>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <StatusPill status={status} />
        <span className="pill">
          <span className={`dot ${live ? "ok" : "bad"}`} />
          {live ? "воркер" : "нет воркера"}
        </span>
        <span className="pill">пасс {a.passMatches || 0}</span>
        {a.hasProxy ? <span className="pill">proxy {a.proxyHint}</span> : <span className="pill">без proxy</span>}
        {a.hasSession ? <span className="pill">сессия Steam</span> : <span className="pill">нет сессии</span>}
        {!a.warmupDone && Number(a.warmupUntil) > Date.now() ? <span className="pill">прогрев</span> : null}
        {claimed ? <span className="pill">награды забраны</span> : null}
        {a.passDone && !claimed ? <span className="pill">неделя закрыта</span> : null}
      </div>
      {a.lastError ? <p className="err" style={{ marginTop: 10 }}>{a.lastError}</p> : null}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={() => onClaim(a.id)} disabled={claimed}>Забрал награды</button>
        <Link className="btn" href={`/accounts/${a.id}`}>Инвентарь</Link>
        {onDelete ? (
          <button className="btn danger" type="button" onClick={() => onDelete(a.id)}>Удалить</button>
        ) : null}
      </div>
    </article>
  );
}
