"use client";

import { useEffect, useMemo, useState } from "react";
import type { AccView } from "./AccountCard";

function leftText(until: number, now: number) {
  const ms = Math.max(0, until - now);
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (ms <= 0) return "вышел";
  if (d > 0) return `${d}д ${h}ч ${m}м`;
  if (h > 0) return `${h}ч ${m}м`;
  return `${m}м`;
}

function exitAt(until: number) {
  try {
    return new Date(until).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function WarmupTab({
  accounts,
  enabled,
  onLoad
}: {
  accounts: AccView[];
  enabled: boolean;
  onLoad: () => Promise<void>;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const list = useMemo(() => {
    return accounts
      .filter((a) => !a.testOnly && !a.warmupDone && Number(a.warmupUntil) > now)
      .sort((a, b) => Number(a.warmupUntil) - Number(b.warmupUntil));
  }, [accounts, now]);

  async function skip(id: string) {
    await fetch(`/api/accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ warmupDone: true, warmupUntil: Date.now() })
    });
    await onLoad();
  }

  return (
    <>
      <section className="stats">
        <div className="card stat"><div className="k">В прогреве</div><div className="v">{list.length}</div></div>
        <div className="card stat"><div className="k">Ближний выход</div><div className="v">{list[0] ? leftText(Number(list[0].warmupUntil), now) : "-"}</div></div>
      </section>
      <p className="muted">
        14 дней с момента добавления. Пока не выйдет, в цикл пасса не идёт. {enabled ? "Прогрев включён." : "Выключен в Конфиге."}
      </p>
      <div className="warm-list">
        {list.map((a) => (
          <article className="card warm-row" key={a.id}>
            <div className="acc-head">
              {a.avatar ? <img src={a.avatar} alt="" /> : <div style={{ width: 42, height: 42, borderRadius: 10, background: "#0f131a" }} />}
              <div>
                <h3>{a.persona || a.login || "без логина"}</h3>
                <p>{a.login || "логин пустой"}{a.email ? ` · ${a.email}` : ""}{a.steamId ? ` · ${a.steamId}` : ""}</p>
              </div>
            </div>
            <div>
              <div className="muted">осталось</div>
              <div className="warm-left">{leftText(Number(a.warmupUntil), now)}</div>
            </div>
            <div>
              <div className="muted">выход</div>
              <div>{exitAt(Number(a.warmupUntil))}</div>
            </div>
            <div className="row">
              <button className="btn" type="button" onClick={() => skip(a.id)}>Пропустить</button>
              <button
                className="btn"
                type="button"
                onClick={async () => {
                  await fetch(`/api/accounts/${a.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ testOnly: true, warmupDone: true, warmupUntil: 0 })
                  });
                  await onLoad();
                }}
              >
                В тест
              </button>
              <button
                className="btn danger"
                type="button"
                onClick={async () => {
                  await fetch(`/api/accounts/${a.id}`, { method: "DELETE" });
                  await onLoad();
                }}
              >
                Удалить
              </button>
            </div>
          </article>
        ))}
      </div>
      {!list.length ? <p className="muted">Пусто. Новые акки из Конфига появятся здесь, таймер 14 дней.</p> : null}
    </>
  );
}
