"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  RefreshCw,
  Star,
  Trash2,
} from "lucide-react";
import { useLocale } from "@/shared/lib/locale-context";
import { SelectMenu } from "@/shared/ui/select-menu";
import { cn } from "@/shared/lib/utils";
import { readScreenCache, writeScreenCache } from "@/shared/lib/screen-cache";

type VaultEntry = {
  id: string;
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  category: string;
  favorite: boolean;
  updatedAt: string;
};

const CATEGORIES = ["login", "card", "wifi", "note", "other"] as const;

const emptyDraft = {
  title: "",
  username: "",
  password: "",
  url: "",
  notes: "",
  category: "login",
  favorite: false,
};

function genPassword(len = 20) {
  const alphabet =
    "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const VAULT_KEY = "tg-vault-v1";

export function VaultBoard() {
  const { t } = useLocale();
  const [entries, setEntries] = useState<VaultEntry[]>(
    () => readScreenCache<VaultEntry[]>(VAULT_KEY) ?? [],
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [query, setQuery] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/vault?reveal=1", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    const list = (data.entries ?? []) as VaultEntry[];
    setEntries(list);
    writeScreenCache(VAULT_KEY, list, false);
  }, []);

  useLayoutEffect(() => {
    const cached = readScreenCache<VaultEntry[]>(VAULT_KEY);
    if (cached) setEntries(cached);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (creating) {
      setDraft(emptyDraft);
      setShowPw(true);
      return;
    }
    const e = entries.find((x) => x.id === activeId);
    if (e) {
      setDraft({
        title: e.title,
        username: e.username,
        password: e.password,
        url: e.url,
        notes: e.notes,
        category: e.category,
        favorite: e.favorite,
      });
      setShowPw(false);
    }
  }, [activeId, entries, creating]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.username.toLowerCase().includes(q) ||
        e.url.toLowerCase().includes(q),
    );
  }, [entries, query]);

  async function createEntry() {
    setCreating(true);
    setActiveId(null);
    setDraft({ ...emptyDraft, password: genPassword() });
    setShowPw(true);
  }

  async function saveEntry() {
    if (!draft.title.trim()) return;
    if (creating) {
      const res = await fetch("/api/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      setCreating(false);
      await load();
      setActiveId(data.entry.id);
      return;
    }
    if (!activeId) return;
    await fetch(`/api/vault/${activeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    await load();
  }

  async function toggleFavorite(id: string, favorite: boolean) {
    await fetch(`/api/vault/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favorite: !favorite }),
    });
    await load();
  }

  async function removeEntry(id: string) {
    await fetch(`/api/vault/${id}`, { method: "DELETE" });
    if (activeId === id) setActiveId(null);
    setCreating(false);
    await load();
  }

  async function copyPassword() {
    await navigator.clipboard.writeText(draft.password);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  const editing = creating || Boolean(activeId);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-muted">
            {t.vault.title}
          </p>
          <h1 className="font-display text-3xl md:text-4xl mt-1">
            {t.vault.title}
          </h1>
          <p className="text-sm text-muted mt-1">{t.vault.subtitle}</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => void createEntry()}>
          <Plus className="size-4" />
          {t.vault.add}
        </button>
      </header>

      <div className="grid lg:grid-cols-[300px_1fr] gap-4 min-h-[520px]">
        <div className="rounded-2xl border border-edge bg-panel/70 overflow-hidden flex flex-col">
          <div className="p-3 border-b border-edge">
            <input
              className="field"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.vault.search}
            />
          </div>
          {filtered.length === 0 ? (
            <p className="p-5 text-sm text-muted">{t.vault.empty}</p>
          ) : (
            <ul className="divide-y divide-edge overflow-y-auto max-h-[560px]">
              {filtered.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setCreating(false);
                      setActiveId(e.id);
                    }}
                    className={cn(
                      "w-full text-left px-4 py-3 hover:bg-surface transition-colors",
                      !creating && activeId === e.id && "bg-accent/10",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <KeyRound className="size-3.5 text-muted shrink-0" />
                      {e.favorite && (
                        <Star className="size-3 text-amber-400 fill-amber-400" />
                      )}
                      <span className="font-medium truncate">{e.title}</span>
                    </div>
                    <p className="text-xs text-muted truncate mt-1 pl-5">
                      {e.username || e.url || "..."}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <AnimatePresence mode="wait">
          {editing ? (
            <motion.div
              key={creating ? "new" : activeId}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="rounded-2xl border border-edge bg-panel/70 p-5 shadow-soft flex flex-col gap-3"
            >
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="space-y-1.5 sm:col-span-2">
                  <span className="text-xs text-muted">{t.vault.titleLabel}</span>
                  <input
                    className="field"
                    value={draft.title}
                    onChange={(e) =>
                      setDraft({ ...draft, title: e.target.value })
                    }
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs text-muted">{t.vault.username}</span>
                  <input
                    className="field"
                    value={draft.username}
                    onChange={(e) =>
                      setDraft({ ...draft, username: e.target.value })
                    }
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs text-muted">{t.vault.category}</span>
                  <SelectMenu
                    ariaLabel={t.vault.category}
                    value={draft.category}
                    onChange={(category) => setDraft({ ...draft, category })}
                    options={CATEGORIES.map((c) => ({
                      value: c,
                      label: t.vault.categories[c],
                    }))}
                  />
                </label>
                <label className="space-y-1.5 sm:col-span-2">
                  <span className="text-xs text-muted">{t.vault.password}</span>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        className="field pr-10 font-mono"
                        type={showPw ? "text" : "password"}
                        value={draft.password}
                        onChange={(e) =>
                          setDraft({ ...draft, password: e.target.value })
                        }
                      />
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
                        onClick={() => setShowPw((v) => !v)}
                        title={showPw ? t.vault.hide : t.vault.show}
                      >
                        {showPw ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </button>
                    </div>
                    <button
                      type="button"
                      className="btn-ghost shrink-0"
                      onClick={() => void copyPassword()}
                      title={copied ? t.vault.copied : t.vault.copy}
                    >
                      {copied ? (
                        <Check className="size-4 text-accent" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost shrink-0"
                      onClick={() =>
                        setDraft({ ...draft, password: genPassword() })
                      }
                      title={t.vault.generate}
                    >
                      <RefreshCw className="size-4" />
                    </button>
                  </div>
                </label>
                <label className="space-y-1.5 sm:col-span-2">
                  <span className="text-xs text-muted">{t.vault.url}</span>
                  <input
                    className="field"
                    value={draft.url}
                    onChange={(e) =>
                      setDraft({ ...draft, url: e.target.value })
                    }
                  />
                </label>
                <label className="space-y-1.5 sm:col-span-2">
                  <span className="text-xs text-muted">{t.vault.notes}</span>
                  <textarea
                    className="field min-h-[100px] resize-none"
                    value={draft.notes}
                    onChange={(e) =>
                      setDraft({ ...draft, notes: e.target.value })
                    }
                  />
                </label>
              </div>

              <div className="mt-auto flex items-center justify-end gap-1.5 pt-2 border-t border-edge/60">
                {!creating && activeId && (
                  <button
                    type="button"
                    title={t.vault.favorite}
                    className={cn(
                      "inline-flex size-9 items-center justify-center rounded-lg border border-edge text-muted transition hover:bg-surface hover:text-ink",
                      draft.favorite &&
                        "text-amber-400 border-amber-400/40 bg-amber-400/10",
                    )}
                    onClick={() => {
                      setDraft({ ...draft, favorite: !draft.favorite });
                      void toggleFavorite(activeId, draft.favorite);
                    }}
                  >
                    <Star
                      className={cn(
                        "size-4",
                        draft.favorite && "fill-amber-400",
                      )}
                    />
                  </button>
                )}
                {!creating && activeId && (
                  <button
                    type="button"
                    title={t.vault.delete}
                    className="inline-flex size-9 items-center justify-center rounded-lg border border-danger/40 bg-danger/10 text-danger transition hover:bg-danger/20"
                    onClick={() => void removeEntry(activeId)}
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
                {creating && (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      setCreating(false);
                      setDraft(emptyDraft);
                    }}
                  >
                    {t.vault.cancel}
                  </button>
                )}
                <button
                  type="button"
                  title={t.vault.save}
                  className="inline-flex size-9 items-center justify-center rounded-lg bg-accent text-white transition hover:brightness-110"
                  onClick={() => void saveEntry()}
                >
                  <Check className="size-4" />
                </button>
              </div>
            </motion.div>
          ) : (
            <div className="rounded-2xl border border-dashed border-edge flex items-center justify-center text-muted text-sm">
              {t.vault.empty}
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
