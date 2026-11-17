"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useLocale } from "@/shared/lib/locale-context";
import {
  CATEGORY_EMOJIS,
  CATEGORY_PALETTE,
} from "@/shared/lib/finance-categories";
import { cn } from "@/shared/lib/utils";

export type FinanceCategory = {
  id: string;
  key: string;
  name: string;
  emoji: string;
  color: string;
  kind: "expense" | "income" | "both";
  builtin: boolean;
};

const emptyForm = {
  name: "",
  emoji: "✨",
  color: CATEGORY_PALETTE[0],
  kind: "expense" as FinanceCategory["kind"],
};

export function CategoryManager({
  open,
  categories,
  onClose,
  onChanged,
}: {
  open: boolean;
  categories: FinanceCategory[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const { t } = useLocale();
  const [tab, setTab] = useState<"expense" | "income">("expense");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  function startCreate(kind: "expense" | "income" = tab) {
    setEditingId(null);
    setForm({ ...emptyForm, kind });
  }

  function selectTab(kind: "expense" | "income") {
    setTab(kind);
    startCreate(kind);
  }

  function startEdit(cat: FinanceCategory) {
    if (cat.kind === "income" || cat.kind === "expense") setTab(cat.kind);
    setEditingId(cat.id);
    setForm({
      name: cat.name,
      emoji: cat.emoji,
      color: cat.color,
      kind: cat.kind,
    });
  }

  async function save() {
    const name = form.name.trim();
    if (!name) return;
    const payload = { ...form, name, kind: form.kind };
    if (editingId) {
      await fetch(`/api/finance/categories/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      await fetch("/api/finance/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
    startCreate(tab);
    await onChanged();
  }

  async function remove(id: string) {
    await fetch(`/api/finance/categories/${id}`, { method: "DELETE" });
    if (editingId === id) startCreate();
    await onChanged();
  }

  const tabs = [
    ["expense", t.finance.kindExpense],
    ["income", t.finance.kindIncome],
  ] as const;

  const visible = categories.filter(
    (cat) => cat.kind === tab || cat.kind === "both",
  );

  function labelOf(cat: FinanceCategory) {
    const dict = t.finance.categories as Record<string, string>;
    if (cat.builtin && dict[cat.key]) return dict[cat.key];
    return cat.name;
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 backdrop-blur-sm sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            className="max-h-[min(720px,90vh)] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-edge bg-panel p-5 shadow-soft"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-xl">{t.finance.manageCategories}</h2>
              <button type="button" className="btn-ghost" onClick={() => startCreate(tab)}>
                <Plus className="size-4" />
                {t.finance.newCategory}
              </button>
            </div>

            <div className="flex gap-1">
              {tabs.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => selectTab(key)}
                  className={cn(
                    "flex-1 rounded-xl border py-2 text-sm transition",
                    tab === key
                      ? key === "income"
                        ? "border-accent/40 bg-accent/15 text-ink"
                        : "border-danger/40 bg-danger/10 text-ink"
                      : "border-edge text-muted hover:bg-surface",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="space-y-3 rounded-xl border border-edge bg-surface/40 p-3">
              <div className="text-xs text-muted">
                {editingId ? t.finance.editCategory : t.finance.newCategory}
              </div>
              <input
                className="field"
                value={form.name}
                placeholder={t.finance.categoryName}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <div className="space-y-1.5">
                <span className="text-xs text-muted">{t.finance.emoji}</span>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORY_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setForm({ ...form, emoji })}
                      className={cn(
                        "inline-flex size-9 items-center justify-center rounded-lg border text-base",
                        form.emoji === emoji
                          ? "border-accent bg-accent/15"
                          : "border-edge hover:bg-surface",
                      )}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <span className="text-xs text-muted">{t.finance.color}</span>
                <div className="flex flex-wrap gap-2">
                  {CATEGORY_PALETTE.map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={color}
                      onClick={() => setForm({ ...form, color })}
                      className={cn(
                        "size-7 rounded-full border-2",
                        form.color.toLowerCase() === color
                          ? "border-ink"
                          : "border-transparent",
                      )}
                      style={{ background: color }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex justify-end">
                <button type="button" className="btn-primary" onClick={() => void save()}>
                  {t.finance.save}
                </button>
              </div>
            </div>

            <ul className="divide-y divide-edge overflow-hidden rounded-xl border border-edge">
              {visible.length === 0 ? (
                <li className="px-3 py-6 text-center text-sm text-muted">
                  {t.finance.categoriesEmpty}
                </li>
              ) : null}
              {visible.map((cat) => (
                <li key={cat.id} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="text-lg">{cat.emoji}</span>
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: cat.color }}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{labelOf(cat)}</span>
                  <button
                    type="button"
                    className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-ink"
                    title={t.finance.editCategory}
                    onClick={() => startEdit(cat)}
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    type="button"
                    className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-danger/10 hover:text-danger"
                    title={t.finance.deleteCategory}
                    onClick={() => void remove(cat.id)}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>

            <div className="flex justify-end">
              <button type="button" className="btn-ghost" onClick={onClose}>
                {t.finance.cancel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
