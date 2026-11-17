import type { Listing } from "../../entities/listing.js";
import type { HistoryRow } from "../watch/skinport.js";
import { config } from "../../shared/config.js";

export type FedRow = {
  name: string;
  min: number | null;
  suggested: number | null;
  mean: number | null;
  median: number | null;
  qty: number;
  d7avg: number | null;
  d30avg: number | null;
  d90avg: number | null;
  d7vol: number;
  d30vol: number;
  trend7v30: number | null;
  url: string;
};

function classWeight(name: string) {
  const n = name.toLowerCase();
  if (n.includes("★") || n.includes("karambit") || n.includes("bayonet") || n.includes("gloves") || n.includes("wraps")) {
    return 8;
  }
  if (/\bcase\b/.test(n) && !n.includes("|")) return 6;
  if (n.includes("souvenir package") || n.includes("capsule")) return 4;
  if (n.includes("|")) return 3;
  return 1;
}

function watched(name: string, watch: string[]) {
  if (!watch.length) return false;
  const n = name.toLowerCase();
  return watch.some((w) => n.includes(w.toLowerCase()));
}

export function buildUniverse(listings: Listing[], history: HistoryRow[], watch: string[]): FedRow[] {
  const hist = new Map(history.map((h) => [h.marketHashName, h]));
  const scored: Array<FedRow & { score: number }> = [];

  for (const row of listings) {
    const min = row.minPrice;
    if (min == null || min < config.outlookMinUsd || min > config.outlookMaxUsd) continue;
    if (row.quantity <= 0) continue;
    const h = hist.get(row.marketHashName);
    const d7 = h?.last7?.avg ?? null;
    const d30 = h?.last30?.avg ?? null;
    const trend = d7 && d30 && d30 > 0 ? (d7 - d30) / d30 : null;
    const d7vol = h?.last7?.volume ?? 0;
    const d30vol = h?.last30?.volume ?? 0;
    let score = classWeight(row.marketHashName) * 10;
    if (watched(row.marketHashName, watch)) score += 40;
    score += Math.min(30, Math.log10(min + 1) * 8);
    if (d30vol > 0) score += Math.min(25, Math.log10(d30vol + 1) * 10);
    if (trend != null) score += Math.min(15, Math.abs(trend) * 40);
    scored.push({
      name: row.marketHashName,
      min,
      suggested: row.suggestedPrice ?? null,
      mean: row.meanPrice ?? null,
      median: row.medianPrice ?? null,
      qty: row.quantity,
      d7avg: d7,
      d30avg: d30,
      d90avg: h?.last90?.avg ?? null,
      d7vol,
      d30vol,
      trend7v30: trend,
      url: row.url,
      score,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, config.outlookLimit).map(({ score: _s, ...row }) => row);
}

export function marketRegime(listings: Listing[], history: HistoryRow[], fed: FedRow[]) {
  const priced = listings.filter((x) => x.minPrice != null) as Array<Listing & { minPrice: number }>;
  const knives = priced.filter((x) => x.marketHashName.includes("★"));
  const knifeMed = median(knives.map((x) => x.minPrice));
  const up = fed.filter((x) => (x.trend7v30 ?? 0) > 0.03).length;
  const down = fed.filter((x) => (x.trend7v30 ?? 0) < -0.05).length;
  const histN = history.length;
  return [
    `date ${new Date().toISOString().slice(0, 10)}`,
    `catalog ${listings.length} priced ${priced.length} historyNames ${histN}`,
    `knifeMedianAsk ${knifeMed ?? "?"}`,
    `fed ${fed.length} weekUp ${up} weekDown ${down}`,
    `currency ${config.currency}`,
    "valve can reprint, patch, or change trade rules. that is the main 12m risk.",
  ].join(" | ");
}

function median(xs: number[]) {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
