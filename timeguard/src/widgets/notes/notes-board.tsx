"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Pin, Plus, Trash2, Check } from "lucide-react";
import { useLocale } from "@/shared/lib/locale-context";
import { notePreview } from "@/shared/lib/note-lines";
import { cn } from "@/shared/lib/utils";
import { NoteEditor } from "./note-editor";
import { readScreenCache, writeScreenCache } from "@/shared/lib/screen-cache";

type Note = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  tags: string[];
  updatedAt: string;
};

const NOTES_KEY = "tg-notes-v1";

export function NotesBoard() {
  const { t } = useLocale();
  const [notes, setNotes] = useState<Note[]>(() => readScreenCache<Note[]>(NOTES_KEY) ?? []);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", body: "" });

  const load = useCallback(async () => {
    const res = await fetch("/api/notes", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    const list = (data.notes ?? []) as Note[];
    setNotes(list);
    writeScreenCache(NOTES_KEY, list);
  }, []);

  useLayoutEffect(() => {
    const cached = readScreenCache<Note[]>(NOTES_KEY);
    if (cached) setNotes(cached);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const n = notes.find((x) => x.id === activeId);
    if (n) setDraft({ title: n.title, body: n.body });
  }, [activeId, notes]);

  async function createNote() {
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: t.notes.placeholderTitle, body: "" }),
    });
    const data = await res.json();
    await load();
    setActiveId(data.note.id);
  }

  async function saveNote() {
    if (!activeId) return;
    await fetch(`/api/notes/${activeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    await load();
  }

  async function togglePin(id: string, pinned: boolean) {
    await fetch(`/api/notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !pinned }),
    });
    await load();
  }

  async function removeNote(id: string) {
    await fetch(`/api/notes/${id}`, { method: "DELETE" });
    if (activeId === id) setActiveId(null);
    await load();
  }

  const active = notes.find((n) => n.id === activeId);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-muted">
            {t.notes.title}
          </p>
          <h1 className="font-display text-3xl md:text-4xl mt-1">{t.notes.title}</h1>
        </div>
        <button type="button" className="btn-primary" onClick={() => void createNote()}>
          <Plus className="size-4" />
          {t.notes.add}
        </button>
      </header>

      <div className="grid lg:grid-cols-[280px_1fr] gap-4 min-h-[480px]">
        <div className="rounded-2xl border border-edge bg-panel/70 overflow-hidden">
          {notes.length === 0 ? (
            <p className="p-5 text-sm text-muted">{t.notes.empty}</p>
          ) : (
            <ul className="divide-y divide-edge">
              {notes.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(n.id)}
                    className={cn(
                      "w-full text-left px-4 py-3 hover:bg-surface transition-colors",
                      activeId === n.id && "bg-accent/10",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {n.pinned && <Pin className="size-3 text-accent" />}
                      <span className="font-medium truncate">{n.title}</span>
                    </div>
                    <p className="text-xs text-muted truncate mt-1">
                      {notePreview(n.body) || "..."}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <AnimatePresence mode="wait">
          {active ? (
            <motion.div
              key={active.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="rounded-2xl border border-edge bg-panel/70 p-5 shadow-soft flex flex-col gap-3 min-h-[480px]"
            >
              <input
                className="field text-xl font-display border-0 bg-transparent px-0 focus:ring-0"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder={t.notes.placeholderTitle}
              />
              <NoteEditor
                value={draft.body}
                onChange={(body) => setDraft({ ...draft, body })}
                placeholder={t.notes.placeholderBody}
                checklistLabel={t.notes.checklist}
              />
              <div className="mt-auto flex items-center justify-end gap-1.5 pt-2 border-t border-edge/60">
                <button
                  type="button"
                  title={active.pinned ? t.notes.unpin : t.notes.pin}
                  aria-label={active.pinned ? t.notes.unpin : t.notes.pin}
                  className={cn(
                    "inline-flex size-9 items-center justify-center rounded-lg border border-edge text-muted transition hover:bg-surface hover:text-ink",
                    active.pinned && "text-accent border-accent/40 bg-accent/10",
                  )}
                  onClick={() => void togglePin(active.id, active.pinned)}
                >
                  <Pin className="size-4" />
                </button>
                <button
                  type="button"
                  title={t.notes.delete}
                  aria-label={t.notes.delete}
                  className="inline-flex size-9 items-center justify-center rounded-lg border border-danger/40 bg-danger/10 text-danger transition hover:bg-danger/20"
                  onClick={() => void removeNote(active.id)}
                >
                  <Trash2 className="size-4" />
                </button>
                <button
                  type="button"
                  title={t.notes.save}
                  aria-label={t.notes.save}
                  className="inline-flex size-9 items-center justify-center rounded-lg bg-accent text-white transition hover:brightness-110"
                  onClick={() => void saveNote()}
                >
                  <Check className="size-4" />
                </button>
              </div>
            </motion.div>
          ) : (
            <div className="rounded-2xl border border-dashed border-edge flex items-center justify-center text-muted text-sm">
              {t.notes.empty}
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
