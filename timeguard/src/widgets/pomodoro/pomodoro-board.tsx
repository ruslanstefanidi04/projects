"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useLocale } from "@/shared/lib/locale-context";
import { useSettings } from "@/shared/lib/settings-context";
import { readScreenCache, writeScreenCache } from "@/shared/lib/screen-cache";

type Kind = "focus" | "break" | "long";

type SessionRow = {
  id: string;
  kind: string;
  durationSec: number;
  completed: boolean;
};

function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.value = 0.08;
    o.start();
    o.stop(ctx.currentTime + 0.25);
  } catch {
    /* ignore */
  }
}

const HISTORY_KEY = "tg-pomodoro-v1";

export function PomodoroBoard() {
  const { t } = useLocale();
  const { settings } = useSettings();
  const [kind, setKind] = useState<Kind>("focus");
  const [running, setRunning] = useState(false);
  const [cycle, setCycle] = useState(0);
  const [left, setLeft] = useState(settings.pomodoroFocus * 60);
  const [history, setHistory] = useState<SessionRow[]>(
    () => readScreenCache<SessionRow[]>(HISTORY_KEY) ?? [],
  );
  const endAt = useRef<number | null>(null);

  const durationFor = useCallback(
    (k: Kind) => {
      if (k === "focus") return settings.pomodoroFocus * 60;
      if (k === "long") return settings.pomodoroLong * 60;
      return settings.pomodoroBreak * 60;
    },
    [settings],
  );

  useEffect(() => {
    if (!running) setLeft(durationFor(kind));
  }, [kind, durationFor, running, settings.pomodoroFocus, settings.pomodoroBreak, settings.pomodoroLong]);

  const loadHistory = useCallback(async () => {
    const res = await fetch("/api/pomodoro", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    const list = (data.sessions ?? []) as SessionRow[];
    setHistory(list);
    writeScreenCache(HISTORY_KEY, list);
  }, []);

  useLayoutEffect(() => {
    const cached = readScreenCache<SessionRow[]>(HISTORY_KEY);
    if (cached) setHistory(cached);
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (!running) return;
    const tick = () => {
      if (!endAt.current) return;
      const next = Math.max(0, Math.ceil((endAt.current - Date.now()) / 1000));
      setLeft(next);
      if (next <= 0) {
        setRunning(false);
        endAt.current = null;
        if (settings.soundEnabled) beep();
        void fetch("/api/pomodoro", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind,
            durationSec: durationFor(kind),
            completed: true,
          }),
        }).then(() => loadHistory());

        if (kind === "focus") {
          const nextCycle = cycle + 1;
          setCycle(nextCycle);
          const nextKind: Kind =
            nextCycle % settings.pomodoroCycles === 0 ? "long" : "break";
          setKind(nextKind);
          setLeft(durationFor(nextKind));
        } else {
          setKind("focus");
          setLeft(durationFor("focus"));
        }
      }
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [running, kind, cycle, settings, durationFor, loadHistory]);

  function start() {
    endAt.current = Date.now() + left * 1000;
    setRunning(true);
  }

  function pause() {
    setRunning(false);
    endAt.current = null;
  }

  function reset() {
    pause();
    setLeft(durationFor(kind));
  }

  function skip() {
    pause();
    if (kind === "focus") {
      const nextCycle = cycle + 1;
      setCycle(nextCycle);
      const nextKind: Kind =
        nextCycle % settings.pomodoroCycles === 0 ? "long" : "break";
      setKind(nextKind);
      setLeft(durationFor(nextKind));
    } else {
      setKind("focus");
      setLeft(durationFor("focus"));
    }
  }

  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  const total = durationFor(kind);
  const progress = total ? 1 - left / total : 0;

  const label = useMemo(() => {
    if (kind === "focus") return t.pomodoro.focus;
    if (kind === "long") return t.pomodoro.longBreak;
    return t.pomodoro.break;
  }, [kind, t]);

  return (
    <div className="space-y-8 max-w-xl mx-auto">
      <header className="text-center">
        <p className="text-xs uppercase tracking-[0.28em] text-muted">
          {t.pomodoro.title}
        </p>
        <h1 className="font-display text-3xl md:text-4xl mt-1">{label}</h1>
        <p className="text-sm text-muted mt-2">
          {t.pomodoro.cycles} {cycle + 1} / {settings.pomodoroCycles}
        </p>
      </header>

      <div className="flex flex-wrap justify-center gap-2">
        {(["focus", "break", "long"] as Kind[]).map((k) => (
          <button
            key={k}
            type="button"
            disabled={running}
            className={`btn-ghost text-sm ${kind === k ? "ring-1 ring-accent text-ink" : ""}`}
            onClick={() => {
              setKind(k);
              setLeft(durationFor(k));
            }}
          >
            {k === "focus"
              ? t.pomodoro.focus
              : k === "long"
                ? t.pomodoro.longBreak
                : t.pomodoro.break}
          </button>
        ))}
      </div>

      <div className="relative mx-auto size-64 md:size-72">
        <svg viewBox="0 0 120 120" className="size-full -rotate-90">
          <circle
            cx="60"
            cy="60"
            r="52"
            fill="none"
            stroke="hsl(var(--edge))"
            strokeWidth="6"
          />
          <motion.circle
            cx="60"
            cy="60"
            r="52"
            fill="none"
            stroke="hsl(var(--accent))"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 52}
            animate={{ strokeDashoffset: 2 * Math.PI * 52 * (1 - progress) }}
            transition={{ ease: "linear", duration: 0.2 }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="font-mono text-5xl md:text-6xl tracking-tight tabular-nums">
            {mm}:{ss}
          </div>
        </div>
      </div>

      <div className="flex justify-center gap-3">
        {!running ? (
          <button type="button" className="btn-primary px-8" onClick={start}>
            {t.pomodoro.start}
          </button>
        ) : (
          <button type="button" className="btn-primary px-8" onClick={pause}>
            {t.pomodoro.pause}
          </button>
        )}
        <button type="button" className="btn-ghost" onClick={reset}>
          {t.pomodoro.reset}
        </button>
        <button type="button" className="btn-ghost" onClick={skip}>
          {t.pomodoro.skip}
        </button>
      </div>

      <div className="rounded-2xl border border-edge bg-panel/70 p-4">
        <h2 className="text-sm text-muted mb-3">
          {t.pomodoro.history} · {history.filter((s) => s.completed).length}{" "}
          {t.pomodoro.completed}
        </h2>
        <ul className="space-y-2 max-h-40 overflow-auto">
          {history.slice(0, 8).map((s) => (
            <li
              key={s.id}
              className="flex justify-between text-sm border-b border-edge/60 pb-2"
            >
              <span>
                {s.kind === "focus"
                  ? t.pomodoro.focus
                  : s.kind === "long"
                    ? t.pomodoro.longBreak
                    : t.pomodoro.break}
              </span>
              <span className="font-mono text-muted">
                {Math.round(s.durationSec / 60)}m
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
