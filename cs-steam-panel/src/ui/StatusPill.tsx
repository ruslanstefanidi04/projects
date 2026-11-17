"use client";

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, { t: string; c: string }> = {
    idle: { t: "ожидание", c: "" },
    starting: { t: "запуск", c: "warn" },
    steam: { t: "Steam", c: "warn" },
    cs2: { t: "CS2", c: "run" },
    queued: { t: "поиск", c: "run" },
    ingame: { t: "матч", c: "ok" },
    trading: { t: "трейд", c: "run" },
    passdone: { t: "пасс готов", c: "ok" },
    warmup: { t: "прогрев", c: "warn" },
    idleplay: { t: "часы в играх", c: "run" },
    error: { t: "ошибка", c: "bad" },
    offline: { t: "оффлайн", c: "bad" }
  };
  const x = map[status] || { t: status, c: "" };
  return (
    <span className="pill">
      <span className={`dot ${x.c}`} />
      {x.t}
    </span>
  );
}
