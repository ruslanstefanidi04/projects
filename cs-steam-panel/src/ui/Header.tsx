"use client";

export function Header({
  tab,
  onTab,
  onStart,
  onStop,
  onLogout,
  running,
  warmupCount
}: {
  tab: "play" | "test" | "warmup" | "proxies" | "config";
  onTab: (t: "play" | "test" | "warmup" | "proxies" | "config") => void;
  onStart: () => void;
  onStop: () => void;
  onLogout: () => void;
  running: boolean;
  warmupCount: number;
}) {
  return (
    <div className="top">
      <div className="brand">
        <h1>CS Farm</h1>
        <nav className="tabs">
          <button className={tab === "play" ? "tab on" : "tab"} onClick={() => onTab("play")}>Аккаунты</button>
          <button className={tab === "warmup" ? "tab on" : "tab"} onClick={() => onTab("warmup")}>Прогрев{warmupCount ? ` ${warmupCount}` : ""}</button>
          <button className={tab === "test" ? "tab on" : "tab"} onClick={() => onTab("test")}>Тест</button>
          <button className={tab === "proxies" ? "tab on" : "tab"} onClick={() => onTab("proxies")}>Прокси</button>
          <button className={tab === "config" ? "tab on" : "tab"} onClick={() => onTab("config")}>Конфиг</button>
        </nav>
      </div>
      <div className="row">
        {tab === "play" ? (
          running ? (
            <button className="btn danger" onClick={onStop}>Стоп</button>
          ) : (
            <button className="btn pri" onClick={onStart}>Старт</button>
          )
        ) : null}
        <button className="btn" onClick={onLogout}>Выйти</button>
      </div>
    </div>
  );
}
