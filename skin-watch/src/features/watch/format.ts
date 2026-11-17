import type { Alert } from "../../entities/listing.js";
import { pnl, type JournalRow } from "../../entities/journal.js";

const tag: Record<Alert["kind"], string> = {
  extreme: "EXTREME",
  snipe: "SNIPE",
  floor: "FLOOR",
  spread: "SPREAD",
  pattern: "PATTERN",
  sticker: "STICKER",
  rise: "RISE",
  list: "LOT",
};

function fmtMoney(n: number | string, currency: string) {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return String(n);
  try {
    return v.toLocaleString("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: Math.abs(v) >= 100 ? 0 : 2,
      maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 2,
    });
  } catch {
    return `${v} ${currency}`;
  }
}

export function formatAlert(alert: Alert, currency: string) {
  const { listing, kind, discountPct } = alert;
  const disc = discountPct == null ? "?" : `${discountPct.toFixed(1)}%`;
  const min = listing.minPrice ?? "?";
  const sug = listing.suggestedPrice ?? "?";
  return [
    `${tag[kind]} ${listing.marketHashName}${listing.version ? `  ${listing.version}` : ""}`,
    `${fmtMoney(min, currency)}  ${listing.source}  suggested ${fmtMoney(sug, currency)}  off ${disc}`,
    listing.quotes?.length
      ? listing.quotes.map((q) => `${q.source} ${fmtMoney(q.price, currency)}`).join("  ")
      : "",
    listing.routeWhy ? listing.routeWhy : "",
    listing.netSame != null
      ? `${listing.netSame > 0 ? "+" : ""}${fmtMoney(listing.netSame, currency)}  ${listing.netSame >= 0 ? "+" : ""}${listing.netSamePct}% after ${listing.netFeeNote ?? listing.source}`
      : "",
    listing.holdWhy ?? "",
    listing.netBestVia && listing.netBest != null
      ? `alt ${listing.netBest > 0 ? "+" : ""}${fmtMoney(listing.netBest, currency)}  ${listing.netBestPct}%  ${listing.netBestVia}`
      : "",
    listing.stickerWhy
      ? `${listing.stickerWhy}${listing.stickerValue ? `  paper ${fmtMoney(listing.stickerValue, currency)}` : ""}`
      : listing.patternTag
      ? `${listing.patternTag}${listing.paintSeed != null ? `  seed ${listing.paintSeed}` : ""}${listing.floatValue != null ? `  fv ${listing.floatValue.toFixed(4)}` : ""}`
      : `qty ${listing.quantity}  ${listing.source}`,
    listing.heatWhy && (listing.heatScore ?? 0) >= 50 ? `rise ${listing.heatScore}  ${listing.heatWhy}` : "",
    "open and buy yourself",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatJournal(rows: JournalRow[], currency: string) {
  const s = pnl(rows);
  const last = rows.slice(-8).map((r) => `${r.side} ${r.name} ${fmtMoney(r.price, currency)}`).join("\n");
  return `bought ${fmtMoney(s.bought, currency)}  sold ${fmtMoney(s.sold, currency)}  paper ${fmtMoney(s.paper, currency)}\n${last || "empty"}`;
}
