"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useLocale } from "@/shared/lib/locale-context";
import { cn } from "@/shared/lib/utils";
import { contourCopy, type ContourCopy } from "./roadmap";

const STORAGE_KEY = "tg-contour-v1";

type Store = { checked: string[]; forced: string[] };

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { checked: [], forced: [] };
    const parsed = JSON.parse(raw) as Partial<Store>;
    return {
      checked: Array.isArray(parsed.checked) ? parsed.checked.filter((id) => typeof id === "string") : [],
      forced: Array.isArray(parsed.forced) ? parsed.forced.filter((id) => typeof id === "string") : [],
    };
  } catch {
    return { checked: [], forced: [] };
  }
}

function LinkRow({
  kicker,
  label,
  note,
  href,
}: {
  kicker: string;
  label: string;
  note: string;
  href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="group flex items-start justify-between gap-4 rounded-2xl border border-edge bg-surface/50 px-4 py-3.5 transition hover:border-accent"
    >
      <span className="min-w-0">
        <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
          {kicker}
        </span>
        <span className="mt-1 block text-sm font-medium text-ink">{label}</span>
        <span className="mt-1 block text-sm leading-relaxed text-muted">{note}</span>
      </span>
      <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-accent transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
    </a>
  );
}

function StageBlock({
  stage,
  copy,
  checked,
  forced,
  onToggle,
  onFold,
  onOpen,
}: {
  stage: ContourCopy["stages"][number];
  copy: ContourCopy;
  checked: string[];
  forced: boolean;
  onToggle: (topicId: string) => void;
  onFold: () => void;
  onOpen: () => void;
}) {
  const done = stage.topics.filter((topic) => checked.includes(topic.id)).length;
  const total = stage.topics.length;
  const complete = done === total;
  const collapsed = complete && !forced;
  const pct = Math.round((done / total) * 100);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-4 rounded-3xl border border-accent/35 bg-panel px-4 py-4 text-left shadow-soft transition hover:border-accent"
      >
        <span className="font-mono text-sm text-accent">{stage.index}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-xl leading-none">{stage.title}</span>
          <span className="mt-1 block text-sm text-muted">
            {copy.done}. {stage.when}
          </span>
        </span>
        <span className="shrink-0 rounded-full border border-accent/40 px-3 py-1 font-mono text-xs text-accent">
          {done}/{total}
        </span>
      </button>
    );
  }

  return (
    <article className="overflow-hidden rounded-3xl border border-edge bg-panel shadow-soft">
      <div className="h-1 bg-surface">
        <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <div className="space-y-5 px-4 py-5 md:px-6 md:py-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <div className="font-mono text-xs tracking-[0.18em] text-accent">{stage.index}</div>
            <h2 className="mt-1 font-display text-3xl leading-none">{stage.title}</h2>
            <p className="mt-2 text-sm text-muted">{stage.when}</p>
          </div>
          <div className="font-mono text-sm text-muted">
            {done} {copy.of} {total}
          </div>
        </header>
        <p className="max-w-2xl text-sm leading-relaxed text-ink/90">{stage.summary}</p>
        <div className="grid gap-3 md:grid-cols-2">
          <LinkRow
            kicker={copy.read}
            label={stage.source.label}
            note={stage.source.note}
            href={stage.source.href}
          />
          <LinkRow
            kicker={copy.practice}
            label={stage.practice.label}
            note={stage.practice.note}
            href={stage.practice.href}
          />
        </div>
        <ul className="space-y-2">
          {stage.topics.map((topic) => {
            const on = checked.includes(topic.id);
            const section = topic.href?.split("/").filter(Boolean).pop();
            return (
              <li
                key={topic.id}
                className={cn(
                  "rounded-2xl border px-3 py-3 transition",
                  on ? "border-accent/40 bg-accent/5" : "border-edge bg-surface/40",
                )}
              >
                <label className="flex cursor-pointer gap-3">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => onToggle(topic.id)}
                    className="mt-1 size-4 shrink-0 accent-[hsl(var(--accent))]"
                  />
                  <span className="min-w-0">
                    <span className={cn("block text-sm font-medium", on && "text-muted line-through")}>
                      {topic.title}
                    </span>
                    <span className="mt-1 block text-sm leading-relaxed text-muted">{topic.detail}</span>
                  </span>
                </label>
                {topic.href && section && (
                  <a
                    href={topic.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="ml-7 mt-2 inline-flex items-center gap-1 text-sm text-accent"
                  >
                    ssd.eff.org/{section}
                    <ArrowUpRight className="size-3.5" />
                  </a>
                )}
              </li>
            );
          })}
        </ul>
        {complete && (
          <button type="button" onClick={onFold} className="text-sm text-muted underline-offset-2 hover:text-ink hover:underline">
            {copy.fold}
          </button>
        )}
      </div>
    </article>
  );
}

export function ContourBoard() {
  const { locale } = useLocale();
  const copy = useMemo(() => contourCopy(locale), [locale]);
  const [checked, setChecked] = useState<string[]>([]);
  const [forced, setForced] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const stored = loadStore();
    setChecked(stored.checked);
    setForced(stored.forced);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const payload: Store = { checked, forced };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [checked, forced, ready]);

  const total = copy.stages.reduce((sum, stage) => sum + stage.topics.length, 0);
  const done = copy.stages.reduce(
    (sum, stage) => sum + stage.topics.filter((topic) => checked.includes(topic.id)).length,
    0,
  );

  function toggle(stage: ContourCopy["stages"][number], topicId: string) {
    setChecked((prev) => {
      const next = prev.includes(topicId) ? prev.filter((id) => id !== topicId) : [...prev, topicId];
      const complete = stage.topics.every((topic) => next.includes(topic.id));
      setForced((open) => {
        if (complete) return open.filter((id) => id !== stage.id);
        return open.includes(stage.id) ? open : [...open, stage.id];
      });
      return next;
    });
  }

  function reset() {
    if (!armed) {
      setArmed(true);
      window.setTimeout(() => setArmed(false), 4000);
      return;
    }
    setChecked([]);
    setForced([]);
    setArmed(false);
  }

  return (
    <div className="relative min-h-screen">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-64"
        style={{
          background:
            "radial-gradient(ellipse at top, hsl(var(--accent) / 0.18), transparent 68%)",
        }}
      />
      <div className="relative mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 md:px-6 md:py-14">
        <div className="flex items-center justify-between gap-4">
          <Link href="/day" className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted hover:text-ink">
            {copy.back}
          </Link>
          <div className="font-mono text-sm text-muted">
            {done} {copy.of} {total}
          </div>
        </div>

        <header className="space-y-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-accent">{copy.eyebrow}</p>
          <h1 className="font-display text-4xl leading-none md:text-6xl">{copy.title}</h1>
          <p className="max-w-xl text-base leading-relaxed text-muted">{copy.lead}</p>
        </header>

        <div className="grid gap-3 sm:grid-cols-3">
          {copy.day.map((item) => (
            <div key={item.k} className="rounded-2xl border border-edge bg-panel/80 px-4 py-3">
              <div className="font-display text-2xl leading-none">{item.k}</div>
              <p className="mt-2 text-sm leading-relaxed text-muted">{item.v}</p>
            </div>
          ))}
        </div>

        <div className={cn("space-y-4 transition-opacity", ready ? "opacity-100" : "opacity-0")}>
          {copy.stages.map((stage) => (
            <StageBlock
              key={stage.id}
              stage={stage}
              copy={copy}
              checked={checked}
              forced={forced.includes(stage.id)}
              onToggle={(topicId) => toggle(stage, topicId)}
              onFold={() => setForced((open) => open.filter((id) => id !== stage.id))}
              onOpen={() => setForced((open) => (open.includes(stage.id) ? open : [...open, stage.id]))}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={reset}
          className="self-start text-sm text-muted underline-offset-2 hover:text-ink hover:underline"
        >
          {armed ? copy.resetArmed : copy.reset}
        </button>
      </div>
    </div>
  );
}
