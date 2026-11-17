"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GripVertical, Plus, Trash2, X } from "lucide-react";
import { useLocale } from "@/shared/lib/locale-context";
import { useSettings } from "@/shared/lib/settings-context";
import { cn, minutesToLabel, labelToMinutes } from "@/shared/lib/utils";
import { orderedWeekdays } from "@/shared/lib/weekdays";
import {
  BLOCK_COLORS,
  BLOCK_ICON_IDS,
  DEFAULT_BLOCK_ICON,
} from "@/shared/config/theme";
import { BlockIcon } from "@/shared/lib/block-icons";
import { readScreenCache, writeScreenCache } from "@/shared/lib/screen-cache";

export type Block = {
  id: string;
  weekday: number;
  startMin: number;
  endMin: number;
  title: string;
  color: string;
  icon?: string | null;
  groupId?: string | null;
  note?: string | null;
};

type FormState = {
  id?: string;
  title: string;
  start: string;
  end: string;
  color: string;
  icon: string;
  note: string;
  groupId?: string | null;
};

const emptyForm = (): FormState => ({
  title: "",
  start: "09:00",
  end: "10:00",
  color: BLOCK_COLORS[0],
  icon: DEFAULT_BLOCK_ICON,
  note: "",
});

function shortName(t: ReturnType<typeof useLocale>["t"], day: number) {
  return [
    t.weekdays.short0,
    t.weekdays.short1,
    t.weekdays.short2,
    t.weekdays.short3,
    t.weekdays.short4,
    t.weekdays.short5,
    t.weekdays.short6,
  ][day];
}

function tinyName(t: ReturnType<typeof useLocale>["t"], day: number) {
  return [
    t.weekdays.tiny0,
    t.weekdays.tiny1,
    t.weekdays.tiny2,
    t.weekdays.tiny3,
    t.weekdays.tiny4,
    t.weekdays.tiny5,
    t.weekdays.tiny6,
  ][day];
}

function fullName(t: ReturnType<typeof useLocale>["t"], day: number) {
  return [
    t.weekdays["0"],
    t.weekdays["1"],
    t.weekdays["2"],
    t.weekdays["3"],
    t.weekdays["4"],
    t.weekdays["5"],
    t.weekdays["6"],
  ][day];
}

const BLOCKS_KEY = "tg-blocks-v1";

export function DayBoard({ initialWeekday }: { initialWeekday?: number }) {
  const { t } = useLocale();
  const { settings } = useSettings();
  const today = new Date().getDay();
  const seed =
    initialWeekday != null && initialWeekday >= 0 && initialWeekday <= 6
      ? initialWeekday
      : today;
  const [selected, setSelected] = useState<number[]>([seed]);
  const cachedBlocks = readScreenCache<Block[]>(BLOCKS_KEY);
  const [blocks, setBlocks] = useState<Block[]>(cachedBlocks ?? []);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(!cachedBlocks);
  const [picked, setPicked] = useState<string[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  const dayAnchor = useRef(seed);
  const blockAnchor = useRef<string | null>(null);

  const days = useMemo(
    () => orderedWeekdays(settings.weekStartsOn),
    [settings.weekStartsOn],
  );

  const selectedSorted = useMemo(
    () => [...selected].sort((a, b) => days.indexOf(a) - days.indexOf(b)),
    [selected, days],
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/blocks?weekdays=0,1,2,3,4,5,6", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const list = (data.blocks ?? []) as Block[];
      setBlocks(list);
      writeScreenCache(BLOCKS_KEY, list);
    } finally {
      setLoading(false);
    }
  }, []);

  useLayoutEffect(() => {
    const cached = readScreenCache<Block[]>(BLOCKS_KEY);
    if (!cached) return;
    setBlocks(cached);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(
    () =>
      [...blocks]
        .filter((block) => selected.includes(block.weekday))
        .sort(
        (a, b) =>
          days.indexOf(a.weekday) - days.indexOf(b.weekday) ||
          a.startMin - b.startMin,
      ),
    [blocks, days, selected],
  );

  function seriesCount(b: Block) {
    if (b.groupId) {
      return blocks.filter((x) => x.groupId === b.groupId).length;
    }
    return blocks.filter(
      (x) =>
        x.title === b.title &&
        x.startMin === b.startMin &&
        x.endMin === b.endMin &&
        x.color === b.color &&
        (x.icon ?? "circle") === (b.icon ?? "circle"),
    ).length;
  }

  function onDayClick(d: number, shift: boolean) {
    setPicked([]);
    if (!shift) {
      dayAnchor.current = d;
      setSelected([d]);
      return;
    }
    const a = days.indexOf(dayAnchor.current);
    const b = days.indexOf(d);
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    setSelected(days.slice(from, to + 1));
  }

  function onBlockClick(b: Block, shift: boolean) {
    if (shift) {
      const ids = sorted.map((x) => x.id);
      const anchor = blockAnchor.current ?? b.id;
      blockAnchor.current = blockAnchor.current ?? b.id;
      const a = ids.indexOf(anchor);
      const c = ids.indexOf(b.id);
      if (a < 0 || c < 0) {
        setPicked([b.id]);
        return;
      }
      const from = Math.min(a, c);
      const to = Math.max(a, c);
      setPicked(ids.slice(from, to + 1));
      return;
    }
    blockAnchor.current = b.id;
    setPicked([]);
    openEdit(b);
  }

  async function swapBlocks(fromId: string, toId: string) {
    if (!fromId || fromId === toId) return;
    const a = blocks.find((x) => x.id === fromId);
    const b = blocks.find((x) => x.id === toId);
    if (!a || !b) return;
    const patch = (id: string, src: Block) =>
      fetch(`/api/blocks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startMin: src.startMin,
          endMin: src.endMin,
          weekday: src.weekday,
          scope: "one",
        }),
      });
    await Promise.all([patch(a.id, b), patch(b.id, a)]);
    await load();
  }

  async function removePicked() {
    if (!picked.length) return;
    await Promise.all(
      picked.map((id) => fetch(`/api/blocks/${id}?scope=one`, { method: "DELETE" })),
    );
    setPicked([]);
    setForm(null);
    await load();
  }

  async function saveForm() {
    if (!form || !form.title.trim() || !selectedSorted.length) return;
    const startMin = labelToMinutes(form.start);
    const endMin = labelToMinutes(form.end);
    if (form.id) {
      await fetch(`/api/blocks/${form.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startMin,
          endMin,
          title: form.title.trim(),
          color: form.color,
          icon: form.icon,
          note: form.note || null,
          scope: "group",
        }),
      });
    } else {
      await fetch("/api/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekdays: selectedSorted,
          startMin,
          endMin,
          title: form.title.trim(),
          color: form.color,
          icon: form.icon,
          note: form.note || null,
        }),
      });
    }
    setForm(null);
    await load();
  }

  async function removeBlock(scope: "one" | "group") {
    if (!form?.id) return;
    const q = scope === "one" ? "?scope=one" : "?scope=group";
    await fetch(`/api/blocks/${form.id}${q}`, { method: "DELETE" });
    setForm(null);
    await load();
  }

  function openNew() {
    setForm(emptyForm());
  }

  function openEdit(b: Block) {
    setForm({
      id: b.id,
      title: b.title,
      start: minutesToLabel(b.startMin),
      end: minutesToLabel(b.endMin),
      color: b.color,
      icon: b.icon || DEFAULT_BLOCK_ICON,
      note: b.note ?? "",
      groupId: b.groupId,
    });
  }

  const editingBlock = form?.id
    ? blocks.find((b) => b.id === form.id)
    : null;
  const editingSeries =
    editingBlock != null ? seriesCount(editingBlock) : 0;
  const isSeries = Boolean(form?.groupId) || editingSeries > 1;

  const titleLabel =
    selectedSorted.length === 1
      ? fullName(t, selectedSorted[0])
      : `${selectedSorted.length} ${t.day.daysSelected}`;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-muted">
            {t.day.title}
          </p>
          <h1 className="font-display text-3xl md:text-4xl mt-1 tracking-tight">
            {titleLabel}
          </h1>
          <p className="text-sm text-muted mt-1">{t.day.subtitle}</p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={openNew}
          disabled={!selectedSorted.length}
        >
          <Plus className="size-4" />
          {t.day.add}
        </button>
      </header>

      <div className="space-y-2">
        <p className="text-xs text-muted">{t.day.selectHint}</p>
        <div className="flex flex-nowrap items-center gap-1 md:flex-wrap md:gap-1.5">
          {days.map((d) => {
            const on = selected.includes(d);
            return (
              <button
                key={d}
                type="button"
                onClick={(e) => onDayClick(d, e.shiftKey)}
                className={cn(
                  "h-10 min-w-0 flex-1 rounded-xl px-0 text-xs font-medium transition md:min-w-11 md:flex-none md:px-3 md:text-sm",
                  on
                    ? "bg-accent text-white"
                    : "border border-edge bg-panel/50 text-muted hover:text-ink hover:bg-surface",
                )}
              >
                <span className="md:hidden">{tinyName(t, d)}</span>
                <span className="hidden md:inline">{shortName(t, d)}</span>
              </button>
            );
          })}
          <button
            type="button"
            className="btn-ghost shrink-0 px-2.5 text-xs md:ml-auto md:px-4 md:text-sm"
            onClick={() => setSelected([today])}
          >
            {t.day.today}
          </button>
        </div>
      </div>

      {picked.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-edge bg-panel/80 px-4 py-2.5">
          <span className="text-sm text-muted">
            {picked.length} {t.day.selectedCount}
          </span>
          <button type="button" className="btn-danger" onClick={() => void removePicked()}>
            <Trash2 className="size-4" />
            {t.day.deleteSelected}
          </button>
        </div>
      )}

      {sorted.length > 0 && (
        <p className="text-xs text-muted">{t.day.dragHint}</p>
      )}

      {!loading && sorted.length === 0 ? (
        <button
          type="button"
          onClick={openNew}
          className="w-full rounded-2xl border border-dashed border-edge bg-panel/40 px-6 py-16 text-center transition hover:border-accent/50 hover:bg-accent/5"
        >
          <p className="text-muted text-sm">{t.day.empty}</p>
          <span className="mt-4 inline-flex items-center gap-2 text-accent text-sm font-medium">
            <Plus className="size-4" />
            {t.day.add}
          </span>
        </button>
      ) : (
        <ul className="space-y-3">
          <AnimatePresence initial={false}>
            {sorted.map((b, i) => (
              <motion.li
                key={b.id}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ delay: i * 0.03 }}
                className={cn(
                  "rounded-2xl",
                  dragging === b.id && "opacity-50",
                  picked.includes(b.id) && "ring-2 ring-accent",
                )}
              >
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const fromId = e.dataTransfer.getData("text/plain");
                    setDragging(null);
                    void swapBlocks(fromId, b.id);
                  }}
                  className="flex items-stretch gap-1"
                >
                <span
                  draggable
                  aria-hidden
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", b.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragging(b.id);
                  }}
                  onDragEnd={() => setDragging(null)}
                  className="self-center cursor-grab px-1 text-muted active:cursor-grabbing"
                >
                  <GripVertical className="size-4" />
                </span>
                <button
                  type="button"
                  onClick={(e) => onBlockClick(b, e.shiftKey)}
                  className="group w-full flex items-stretch gap-3 text-left"
                >
                  <div className="w-14 shrink-0 pt-1 text-right">
                    <div className="font-mono text-sm text-ink tabular-nums">
                      {minutesToLabel(b.startMin)}
                    </div>
                    <div className="font-mono text-[11px] text-muted tabular-nums mt-0.5">
                      {minutesToLabel(b.endMin)}
                    </div>
                    {selectedSorted.length > 1 && (
                      <div className="text-[10px] text-accent mt-1 font-medium">
                        {shortName(t, b.weekday)}
                      </div>
                    )}
                  </div>
                  <div
                    className="w-1 self-stretch rounded-full shrink-0 opacity-90"
                    style={{ background: b.color }}
                  />
                  <div
                    className="flex-1 min-w-0 rounded-2xl px-4 py-3.5 border border-white/10 shadow-soft transition group-hover:brightness-110 flex items-center gap-3"
                    style={{
                      background: `linear-gradient(135deg, ${b.color}ee, ${b.color}aa)`,
                    }}
                  >
                    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/20 text-white">
                      <BlockIcon id={b.icon} className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-white truncate">
                        {b.title}
                      </div>
                      {b.note ? (
                        <p className="mt-1 text-xs text-white/80 line-clamp-2">
                          {b.note}
                        </p>
                      ) : (
                        <p className="mt-1 font-mono text-[11px] text-white/75">
                          {minutesToLabel(b.startMin)} -{" "}
                          {minutesToLabel(b.endMin)}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      <AnimatePresence>
        {form && (
          <motion.div
            className="fixed inset-0 z-40 flex items-end md:items-center justify-center bg-ink/40 backdrop-blur-sm p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setForm(null)}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl border border-edge bg-panel p-5 shadow-soft space-y-4 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xl">
                  {form.id ? t.day.save : t.day.add}
                </h2>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setForm(null)}
                >
                  <X className="size-4" />
                </button>
              </div>
              {!form.id && (
                <p className="text-xs text-muted">
                  {t.day.applyTo}:{" "}
                  {selectedSorted.map((d) => shortName(t, d)).join(", ")}
                </p>
              )}
              {form.id && isSeries && (
                <p className="text-xs text-muted">
                  {editingSeries > 1
                    ? t.day.seriesHint.replace("{n}", String(editingSeries))
                    : t.day.seriesHintShort}
                </p>
              )}
              <label className="block space-y-1.5">
                <span className="text-xs text-muted">{t.day.titleLabel}</span>
                <input
                  className="field"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  autoFocus
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1.5">
                  <span className="text-xs text-muted">{t.day.start}</span>
                  <input
                    type="time"
                    className="field"
                    value={form.start}
                    onChange={(e) =>
                      setForm({ ...form, start: e.target.value })
                    }
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs text-muted">{t.day.end}</span>
                  <input
                    type="time"
                    className="field"
                    value={form.end}
                    onChange={(e) => setForm({ ...form, end: e.target.value })}
                  />
                </label>
              </div>
              <div className="space-y-1.5">
                <span className="text-xs text-muted">{t.day.icon}</span>
                <div className="flex flex-wrap gap-1.5">
                  {BLOCK_ICON_IDS.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setForm({ ...form, icon: id })}
                      title={id}
                      className={cn(
                        "inline-flex size-8 items-center justify-center rounded-lg border transition",
                        form.icon === id
                          ? "border-accent bg-accent/15 text-ink"
                          : "border-edge text-muted hover:bg-surface hover:text-ink",
                      )}
                    >
                      <BlockIcon id={id} className="size-3.5" />
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <span className="text-xs text-muted">{t.day.color}</span>
                <div className="flex flex-wrap gap-2">
                  {BLOCK_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm({ ...form, color: c })}
                      className={cn(
                        "size-7 rounded-full border-2",
                        form.color === c
                          ? "border-ink scale-110"
                          : "border-transparent",
                      )}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
              <label className="block space-y-1.5">
                <span className="text-xs text-muted">{t.day.note}</span>
                <textarea
                  className="field min-h-20"
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </label>
              <div className="flex flex-wrap gap-2 justify-end">
                {form.id && (
                  <>
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={() => void removeBlock(isSeries ? "group" : "one")}
                    >
                      {isSeries ? t.day.deleteAll : t.day.delete}
                    </button>
                    {isSeries && (
                      <button
                        type="button"
                        className="btn-ghost text-danger border-danger/30"
                        onClick={() => void removeBlock("one")}
                      >
                        {t.day.deleteOne}
                      </button>
                    )}
                  </>
                )}
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setForm(null)}
                >
                  {t.day.cancel}
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void saveForm()}
                >
                  {t.day.save}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
