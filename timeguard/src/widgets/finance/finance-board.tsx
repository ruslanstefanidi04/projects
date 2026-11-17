"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Plus,
  Trash2,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useLocale } from "@/shared/lib/locale-context";
import { useSettings } from "@/shared/lib/settings-context";
import { CURRENCIES, currencyLabel } from "@/shared/lib/currencies";
import { cn } from "@/shared/lib/utils";
import { readScreenCache, writeScreenCache } from "@/shared/lib/screen-cache";
import { SelectMenu } from "@/shared/ui/select-menu";
import {
  BalanceTrend,
  CashflowBars,
  DonutChart,
  categoryColor,
} from "./finance-charts";
import {
  CategoryManager,
  type FinanceCategory,
} from "./category-manager";

type Tx = {
  id: string;
  kind: "income" | "expense";
  amount: number;
  currency: string;
  category: string;
  title: string;
  note: string;
  date: string;
};

function todayIso() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function monthKey(iso: string) {
  return iso.slice(0, 7);
}

function formatMoney(n: number, locale: string, currency = "USD") {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}

function convertAmount(
  amount: number,
  currency: string,
  base: string,
  rates: Record<string, number> | null,
  fxState: "loading" | "ready" | "error",
) {
  const code = (currency || base).toUpperCase();
  if (code === base) return amount;
  if (fxState === "error") return amount;
  if (fxState !== "ready" || !rates) return null;
  const rate = rates[code];
  if (!rate) return null;
  return amount / rate;
}

const TX_KEY = "tg-finance-tx-v1";
const CAT_KEY = "tg-finance-cat-v1";

const FX_KEY = "tg-fx-v1";

export function FinanceBoard() {
  const { t, locale } = useLocale();
  const { settings } = useSettings();
  const loc = locale === "ru" ? "ru-RU" : "en-US";
  const base = settings.baseCurrency || "USD";
  const [txs, setTxs] = useState<Tx[]>(() => readScreenCache<Tx[]>(TX_KEY) ?? []);
  const [categories, setCategories] = useState<FinanceCategory[]>(
    () => readScreenCache<FinanceCategory[]>(CAT_KEY) ?? [],
  );
  const cachedFx = readScreenCache<{ base: string; rates: Record<string, number> }>(FX_KEY);
  const [rates, setRates] = useState<Record<string, number> | null>(
    cachedFx?.base === base ? cachedFx.rates : null,
  );
  const [fxState, setFxState] = useState<"loading" | "ready" | "error">(
    cachedFx?.base === base ? "ready" : "loading",
  );
  const [filter, setFilter] = useState<"all" | "income" | "expense">("all");
  const [months, setMonths] = useState<6 | 12>(6);
  const [open, setOpen] = useState(false);
  const [catsOpen, setCatsOpen] = useState(false);
  const [draft, setDraft] = useState({
    kind: "expense" as "income" | "expense",
    amount: "",
    category: "food",
    currency: "USD",
    title: "",
    note: "",
    date: todayIso(),
  });

  const load = useCallback(async () => {
    const res = await fetch("/api/finance", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    const list = (data.transactions ?? []) as Tx[];
    setTxs(list);
    writeScreenCache(TX_KEY, list);
  }, []);

  const loadCategories = useCallback(async () => {
    const res = await fetch("/api/finance/categories", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    const list = (data.categories ?? []) as FinanceCategory[];
    setCategories(list);
    writeScreenCache(CAT_KEY, list);
  }, []);

  useLayoutEffect(() => {
    const tx = readScreenCache<Tx[]>(TX_KEY);
    const cats = readScreenCache<FinanceCategory[]>(CAT_KEY);
    if (tx) setTxs(tx);
    if (cats) setCategories(cats);
  }, []);

  useEffect(() => {
    void load();
    void loadCategories();
  }, [load, loadCategories]);

  useEffect(() => {
    let cancelled = false;
    const cached = readScreenCache<{ base: string; rates: Record<string, number> }>(FX_KEY);
    if (cached?.base === base) {
      setRates(cached.rates);
      setFxState("ready");
    } else {
      setFxState("loading");
    }
    void fetch(`/api/fx?base=${encodeURIComponent(base)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("fx");
        return res.json() as Promise<{ rates?: Record<string, number> }>;
      })
      .then((data) => {
        if (cancelled) return;
        setRates(data.rates ?? null);
        setFxState(data.rates ? "ready" : "error");
        if (data.rates) writeScreenCache(FX_KEY, { base, rates: data.rates });
      })
      .catch(() => {
        if (cancelled) return;
        if (cached?.base === base) return;
        setRates(null);
        setFxState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [base]);

  function catMeta(key: string) {
    const cat = categories.find((c) => c.key === key);
    const dict = t.finance.categories as Record<string, string>;
    const label =
      cat?.builtin && dict[key] ? dict[key] : cat?.name ?? dict[key] ?? key;
    return {
      label,
      color: cat?.color ?? categoryColor(key),
      emoji: cat?.emoji ?? "",
    };
  }

  const thisMonth = todayIso().slice(0, 7);

  const stats = useMemo(() => {
    let incomeAll = 0;
    let expenseAll = 0;
    let incomeMonth = 0;
    let expenseMonth = 0;
    for (const tx of txs) {
      const amount = convertAmount(tx.amount, tx.currency, base, rates, fxState);
      if (amount == null) continue;
      if (tx.kind === "income") {
        incomeAll += amount;
        if (monthKey(tx.date) === thisMonth) incomeMonth += amount;
      } else {
        expenseAll += amount;
        if (monthKey(tx.date) === thisMonth) expenseMonth += amount;
      }
    }
    return {
      incomeAll,
      expenseAll,
      balanceAll: incomeAll - expenseAll,
      incomeMonth,
      expenseMonth,
      balanceMonth: incomeMonth - expenseMonth,
    };
  }, [txs, thisMonth, base, rates, fxState]);

  const expenseSlices = useMemo(() => {
    const map = new Map<string, number>();
    for (const tx of txs) {
      if (tx.kind !== "expense" || monthKey(tx.date) !== thisMonth) continue;
      const amount = convertAmount(tx.amount, tx.currency, base, rates, fxState);
      if (amount == null) continue;
      map.set(tx.category, (map.get(tx.category) ?? 0) + amount);
    }
    return Array.from(map.entries())
      .map(([key, value]) => {
        const meta = catMeta(key);
        return {
          key,
          value,
          label: meta.label,
          color: meta.color,
          emoji: meta.emoji,
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [txs, thisMonth, t, categories, base, rates, fxState]);

  const cashflow = useMemo(() => {
    const keys: string[] = [];
    const now = new Date();
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      keys.push(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      );
    }
    return keys.map((key) => {
      let income = 0;
      let expense = 0;
      for (const tx of txs) {
        if (monthKey(tx.date) !== key) continue;
        const amount = convertAmount(tx.amount, tx.currency, base, rates, fxState);
        if (amount == null) continue;
        if (tx.kind === "income") income += amount;
        else expense += amount;
      }
      const [, m] = key.split("-");
      return {
        label: m,
        income,
        expense,
        key,
      };
    });
  }, [txs, months, base, rates, fxState]);

  const trend = useMemo(() => {
    const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));
    let bal = 0;
    const byDay = new Map<string, number>();
    for (const tx of sorted) {
      const amount = convertAmount(tx.amount, tx.currency, base, rates, fxState);
      if (amount == null) continue;
      bal += tx.kind === "income" ? amount : -amount;
      byDay.set(tx.date, bal);
    }
    const points = Array.from(byDay.entries()).map(([label, balance]) => ({
      label: label.slice(5),
      balance,
    }));
    if (points.length > 24) return points.slice(-24);
    return points;
  }, [txs, base, rates, fxState]);

  const visible = useMemo(() => {
    if (filter === "all") return txs;
    return txs.filter((x) => x.kind === filter);
  }, [txs, filter]);

  const kindCategories = categories.filter(
    (c) => c.kind === draft.kind || c.kind === "both",
  );

  async function saveTx() {
    const amount = Number(draft.amount.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) return;
    await fetch("/api/finance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: draft.kind,
        amount,
        category: draft.category,
        title: draft.title,
        note: draft.note,
        date: draft.date,
        currency: draft.currency || base,
      }),
    });
    setOpen(false);
    setDraft({
      kind: "expense",
      amount: "",
      category: kindCategories.find((c) => c.kind !== "income")?.key ?? "food",
      currency: base,
      title: "",
      note: "",
      date: todayIso(),
    });
    await load();
  }

  async function removeTx(id: string) {
    await fetch(`/api/finance/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-muted">
            {t.finance.title}
          </p>
          <h1 className="font-display text-3xl md:text-4xl mt-1">
            {t.finance.title}
          </h1>
          <p className="text-sm text-muted mt-1">{t.finance.subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setCatsOpen(true)}
          >
            {t.finance.manageCategories}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setDraft((d) => ({ ...d, currency: d.currency || base }));
              setOpen(true);
            }}
          >
            <Plus className="size-4" />
            {t.finance.add}
          </button>
        </div>
      </header>

      <div className="grid sm:grid-cols-3 gap-3">
        {[
          {
            label: t.finance.balance,
            sub: t.finance.thisMonth,
            value: stats.balanceMonth,
            icon: Wallet,
            tone: stats.balanceMonth >= 0 ? "text-accent" : "text-danger",
          },
          {
            label: t.finance.income,
            sub: t.finance.thisMonth,
            value: stats.incomeMonth,
            icon: ArrowDownLeft,
            tone: "text-accent",
          },
          {
            label: t.finance.expense,
            sub: t.finance.thisMonth,
            value: stats.expenseMonth,
            icon: ArrowUpRight,
            tone: "text-danger",
          },
        ].map((card) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-edge bg-panel/70 p-4 shadow-soft"
          >
            <div className="flex items-center justify-between text-muted text-xs uppercase tracking-wider">
              <span>{card.label}</span>
              <card.icon className="size-4" />
            </div>
            <div className={cn("font-display text-2xl mt-2 tabular-nums", card.tone)}>
              {fxState === "loading" ? "..." : formatMoney(card.value, loc, base)}
            </div>
            <div className="text-xs text-muted mt-1">{card.sub}</div>
          </motion.div>
        ))}
      </div>

      {fxState === "error" ? (
        <p className="text-center text-xs text-muted">{t.finance.fxError}</p>
      ) : null}

      <div className="rounded-2xl border border-edge bg-panel/70 p-5 shadow-soft">
        <div className="text-center text-sm font-medium">{t.finance.byCategory}</div>
        {expenseSlices.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">{t.finance.empty}</p>
        ) : (
          <>
            <div className="flex justify-center py-4">
              <DonutChart
                slices={expenseSlices}
                locale={loc}
                centerLabel={t.finance.expense}
              />
            </div>
            <ul className="mx-auto max-w-lg space-y-3">
              {expenseSlices.map((s) => {
                const total = expenseSlices.reduce((sum, item) => sum + item.value, 0) || 1;
                const pct = Math.round((s.value / total) * 100);
                return (
                  <li key={s.key} className="space-y-1.5">
                    <div className="flex items-center gap-2 text-sm">
                      {s.emoji ? <span className="text-base leading-none">{s.emoji}</span> : null}
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: s.color }}
                      />
                      <span className="min-w-0 flex-1 truncate">{s.label}</span>
                      <span className="tabular-nums text-muted">{pct}%</span>
                      <span className="tabular-nums shrink-0">
                        {formatMoney(s.value, loc, base)}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${pct}%`, background: s.color }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      <div className="grid gap-4">
        <div className="rounded-2xl border border-edge bg-panel/70 p-4 shadow-soft">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="text-sm font-medium">{t.finance.cashflow}</div>
            <div className="flex gap-1">
              {([6, 12] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMonths(n)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs border transition",
                    months === n
                      ? "border-accent/40 bg-accent/15 text-ink"
                      : "border-edge text-muted hover:bg-surface",
                  )}
                >
                  {n === 6 ? t.finance.period6 : t.finance.period12}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-4 text-xs text-muted mb-2">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-accent" />
              {t.finance.income}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-danger" />
              {t.finance.expense}
            </span>
          </div>
          <CashflowBars points={cashflow} locale={loc} />
        </div>
      </div>

      <div className="rounded-2xl border border-edge bg-panel/70 p-4 shadow-soft">
        <div className="flex items-center gap-2 text-sm font-medium mb-2">
          <TrendingUp className="size-4 text-accent" />
          {t.finance.trend}
          <span className="text-xs text-muted font-normal ml-auto">
            {t.finance.allTime}: {fxState === "loading" ? "..." : formatMoney(stats.balanceAll, loc, base)}
          </span>
        </div>
        <BalanceTrend points={trend} locale={loc} />
      </div>

      <div className="rounded-2xl border border-edge bg-panel/70 overflow-hidden shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-edge">
          <div className="text-sm font-medium">{t.finance.recent}</div>
          <div className="flex gap-1">
            {(
              [
                ["all", t.finance.filterAll],
                ["income", t.finance.filterIncome],
                ["expense", t.finance.filterExpense],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs border transition",
                  filter === key
                    ? "border-accent/40 bg-accent/15 text-ink"
                    : "border-edge text-muted hover:bg-surface",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {visible.length === 0 ? (
          <p className="p-6 text-sm text-muted">{t.finance.empty}</p>
        ) : (
          <ul className="divide-y divide-edge max-h-[420px] overflow-y-auto">
            {visible.map((tx) => (
              <li
                key={tx.id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-surface/60"
              >
                <span
                  className={cn(
                    "inline-flex size-9 items-center justify-center rounded-xl border text-base",
                    tx.kind === "income"
                      ? "border-accent/30 bg-accent/10"
                      : "border-danger/30 bg-danger/10",
                  )}
                >
                  {catMeta(tx.category).emoji ||
                    (tx.kind === "income" ? (
                      <ArrowDownLeft className="size-4 text-accent" />
                    ) : (
                      <ArrowUpRight className="size-4 text-danger" />
                    ))}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">
                    {tx.title || catMeta(tx.category).label}
                  </div>
                  <div className="text-xs text-muted">
                    {tx.date} · {catMeta(tx.category).emoji} {catMeta(tx.category).label}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div
                    className={cn(
                      "tabular-nums font-medium",
                      tx.kind === "income" ? "text-accent" : "text-danger",
                    )}
                  >
                    {tx.kind === "income" ? "+" : "-"}
                    {formatMoney(tx.amount, loc, tx.currency)}
                  </div>
                  {tx.currency !== base && fxState === "ready"
                    ? (() => {
                        const converted = convertAmount(
                          tx.amount,
                          tx.currency,
                          base,
                          rates,
                          fxState,
                        );
                        if (converted == null) return null;
                        return (
                          <div className="text-[11px] tabular-nums text-muted">
                            ≈ {formatMoney(converted, loc, base)}
                          </div>
                        );
                      })()
                    : null}
                </div>
                <button
                  type="button"
                  className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:text-danger hover:bg-danger/10"
                  onClick={() => void removeTx(tx.id)}
                  title={t.finance.delete}
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 16, opacity: 0 }}
              className="w-full max-w-md rounded-2xl border border-edge bg-panel p-5 shadow-soft space-y-3"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="font-display text-xl">{t.finance.add}</h2>
              <div className="flex gap-2">
                {(["expense", "income"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        kind: k,
                        category:
                          categories.find((c) => c.kind === k)?.key ?? draft.category,
                      })
                    }
                    className={cn(
                      "flex-1 rounded-xl border py-2 text-sm transition",
                      draft.kind === k
                        ? k === "income"
                          ? "border-accent/40 bg-accent/15"
                          : "border-danger/40 bg-danger/10"
                        : "border-edge text-muted hover:bg-surface",
                    )}
                  >
                    {k === "income" ? t.finance.income : t.finance.expense}
                  </button>
                ))}
              </div>
              <label className="block space-y-1.5">
                <span className="text-xs text-muted">{t.finance.amount}</span>
                <input
                  className="field"
                  inputMode="decimal"
                  value={draft.amount}
                  onChange={(e) =>
                    setDraft({ ...draft, amount: e.target.value })
                  }
                  placeholder="0"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1.5">
                  <span className="text-xs text-muted">{t.finance.category}</span>
                  <SelectMenu
                    ariaLabel={t.finance.category}
                    value={draft.category}
                    onChange={(category) => setDraft({ ...draft, category })}
                    options={kindCategories.map((c) => ({
                      value: c.key,
                      label: catMeta(c.key).label,
                      emoji: c.emoji,
                      swatch: c.color,
                    }))}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs text-muted">{t.finance.date}</span>
                  <input
                    className="field"
                    type="date"
                    value={draft.date}
                    onChange={(e) =>
                      setDraft({ ...draft, date: e.target.value })
                    }
                  />
                </label>
              </div>
              <label className="block space-y-1.5">
                <span className="text-xs text-muted">{t.finance.currency}</span>
                <SelectMenu
                  ariaLabel={t.finance.currency}
                  value={draft.currency || base}
                  onChange={(currency) => setDraft({ ...draft, currency })}
                  options={CURRENCIES.map((code) => ({
                    value: code,
                    label: currencyLabel(code, loc),
                  }))}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs text-muted">{t.finance.titleLabel}</span>
                <input
                  className="field"
                  value={draft.title}
                  onChange={(e) =>
                    setDraft({ ...draft, title: e.target.value })
                  }
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs text-muted">{t.finance.note}</span>
                <textarea
                  className="field min-h-[72px] resize-none"
                  value={draft.note}
                  onChange={(e) =>
                    setDraft({ ...draft, note: e.target.value })
                  }
                />
              </label>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setOpen(false)}
                >
                  {t.finance.cancel}
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void saveTx()}
                >
                  {t.finance.save}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <CategoryManager
        open={catsOpen}
        categories={categories}
        onClose={() => setCatsOpen(false)}
        onChanged={loadCategories}
      />
    </div>
  );
}
