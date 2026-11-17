"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { enUS, ru as ruLocale } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Check, Plus, Trash2 } from "lucide-react";
import { useLocale } from "@/shared/lib/locale-context";
import { useSettings } from "@/shared/lib/settings-context";
import { cn, dateKey } from "@/shared/lib/utils";
import { readScreenCache, writeScreenCache } from "@/shared/lib/screen-cache";

type Reminder = {
  id: string;
  date: string;
  title: string;
  done: boolean;
};

export function MonthBoard() {
  const { t, locale } = useLocale();
  const { settings } = useSettings();
  const dfLocale = locale === "ru" ? ruLocale : enUS;
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState(() => dateKey(new Date()));
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);

  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, {
    weekStartsOn: settings.weekStartsOn,
  });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: settings.weekStartsOn });
  const gridStartKey = dateKey(gridStart);
  const gridEndKey = dateKey(gridEnd);
  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: parseISO(gridStartKey),
        end: parseISO(gridEndKey),
      }),
    [gridStartKey, gridEndKey],
  );

  const from = gridStartKey;
  const to = gridEndKey;

  const load = useCallback(async () => {
    const key = `tg-reminders-v1:${from}:${to}`;
    const cached = readScreenCache<Reminder[]>(key);
    if (cached) {
      setReminders(cached);
      setLoading(false);
    }
    try {
      const res = await fetch(`/api/reminders?from=${from}&to=${to}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const list = (data.reminders ?? []) as Reminder[];
      setReminders(list);
      writeScreenCache(key, list);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const byDate = useMemo(() => {
    const map = new Map<string, Reminder[]>();
    for (const r of reminders) {
      const list = map.get(r.date) ?? [];
      list.push(r);
      map.set(r.date, list);
    }
    return map;
  }, [reminders]);

  const selectedReminders = byDate.get(selected) ?? [];

  const weekdayLabels = useMemo(() => {
    const base = startOfWeek(new Date(), {
      weekStartsOn: settings.weekStartsOn,
    });
    return Array.from({ length: 7 }, (_, i) =>
      format(addDays(base, i), "EEEEE", { locale: dfLocale }),
    );
  }, [settings.weekStartsOn, dfLocale]);

  async function addReminder() {
    const title = draft.trim();
    if (!title) return;
    await fetch("/api/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: selected, title }),
    });
    setDraft("");
    await load();
  }

  async function toggleDone(r: Reminder) {
    await fetch(`/api/reminders/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: !r.done }),
    });
    await load();
  }

  async function removeReminder(id: string) {
    await fetch(`/api/reminders/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-muted">
            {t.month.title}
          </p>
          <h1 className="font-display text-3xl md:text-4xl mt-1 tracking-tight capitalize">
            {format(cursor, "LLLL yyyy", { locale: dfLocale })}
          </h1>
          <p className="text-sm text-muted mt-1">{t.month.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setCursor((c) => addMonths(c, -1))}
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            className="btn-ghost text-sm"
            onClick={() => {
              const now = new Date();
              setCursor(startOfMonth(now));
              setSelected(dateKey(now));
            }}
          >
            {t.month.today}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setCursor((c) => addMonths(c, 1))}
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </header>

      <div className="grid lg:grid-cols-[1fr_320px] gap-4 items-start">
        <div className="rounded-2xl border border-edge bg-panel/70 p-3 md:p-4 shadow-soft">
          <div className="grid grid-cols-7 gap-1 mb-2">
            {weekdayLabels.map((label, i) => (
              <div
                key={`${label}-${i}`}
                className="text-center text-[11px] uppercase tracking-wider text-muted py-1"
              >
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map((day) => {
              const key = dateKey(day);
              const inMonth = isSameMonth(day, cursor);
              const isSelected = key === selected;
              const isToday = isSameDay(day, new Date());
              const count = byDate.get(key)?.length ?? 0;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelected(key)}
                  className={cn(
                    "relative aspect-square rounded-xl p-1.5 text-left transition border",
                    inMonth ? "text-ink" : "text-muted/50",
                    isSelected
                      ? "border-accent bg-accent/15"
                      : "border-transparent hover:bg-surface",
                    isToday && !isSelected && "ring-1 ring-accent/40",
                  )}
                >
                  <span className="text-sm font-medium">{format(day, "d")}</span>
                  {count > 0 && (
                    <span className="absolute bottom-1.5 left-1.5 right-1.5 flex gap-0.5">
                      {Array.from({ length: Math.min(count, 3) }).map((_, i) => (
                        <span
                          key={i}
                          className="h-1 flex-1 rounded-full bg-accent/80"
                        />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-edge bg-panel/70 p-4 shadow-soft min-h-[320px] flex flex-col">
          <div className="flex items-start justify-between gap-2 mb-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted">
                {t.month.reminders}
              </p>
              <h2 className="font-display text-xl mt-1 capitalize">
                {format(parseISO(selected), "d MMMM", { locale: dfLocale })}
              </h2>
            </div>
          </div>

          <ul className="space-y-2 flex-1">
            {!loading && selectedReminders.length === 0 && (
              <li className="text-sm text-muted py-8 text-center">
                {t.month.empty}
              </li>
            )}
            {selectedReminders.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-2 rounded-xl border border-edge bg-surface/40 px-2.5 py-2"
              >
                <button
                  type="button"
                  title={t.month.done}
                  aria-label={t.month.done}
                  onClick={() => void toggleDone(r)}
                  className={cn(
                    "inline-flex size-8 items-center justify-center rounded-lg border transition",
                    r.done
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-edge text-muted hover:text-ink",
                  )}
                >
                  <Check className="size-4" />
                </button>
                <span
                  className={cn(
                    "flex-1 text-sm min-w-0",
                    r.done && "line-through text-muted",
                  )}
                >
                  {r.title}
                </span>
                <button
                  type="button"
                  title={t.month.delete}
                  aria-label={t.month.delete}
                  onClick={() => void removeReminder(r.id)}
                  className="inline-flex size-8 items-center justify-center rounded-lg border border-danger/30 text-danger hover:bg-danger/10"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>

          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void addReminder();
            }}
          >
            <input
              className="field flex-1"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t.month.placeholder}
            />
            <button type="submit" className="btn-primary px-3" aria-label={t.month.add}>
              <Plus className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
