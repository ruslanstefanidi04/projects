import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../../shared/config.js";
import type { Listing } from "../../entities/listing.js";

type Bucket = {
  avg: number | null;
  median: number | null;
  volume: number;
};

type HistRow = {
  version: string | null;
  last_7_days?: Bucket;
  last_30_days?: Bucket;
};

type CacheFile = Record<string, { at: number; rows: HistRow[] }>;

const TTL = 6 * 60 * 60 * 1000;

function cachePath() {
  mkdirSync(config.dataDir, { recursive: true });
  return join(config.dataDir, "history.json");
}

function loadCache(): CacheFile {
  if (!existsSync(cachePath())) return {};
  try {
    return JSON.parse(readFileSync(cachePath(), "utf8")) as CacheFile;
  } catch {
    return {};
  }
}

function saveCache(cache: CacheFile) {
  writeFileSync(cachePath(), JSON.stringify(cache));
}

async function pullHistory(name: string, currency: string): Promise<HistRow[]> {
  const url = new URL("https://api.skinport.com/v1/sales/history");
  url.searchParams.set("app_id", "730");
  url.searchParams.set("currency", currency);
  url.searchParams.set("market_hash_name", name);
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SkinDesk/0.2",
    },
  });
  if (!res.ok) return [];
  return (await res.json()) as HistRow[];
}

export async function attachHeat(listings: Listing[], currency: string, limit = 16): Promise<Listing[]> {
  const cache = loadCache();
  const now = Date.now();
  const ranked = [...listings].sort((a, b) => (b.minPrice ?? 0) - (a.minPrice ?? 0)).slice(0, limit);

  for (const item of ranked) {
    const hit = cache[item.marketHashName];
    if (hit && now - hit.at < TTL) {
      applyHeat(item, hit.rows);
      continue;
    }
    try {
      const rows = await pullHistory(item.marketHashName, currency);
      cache[item.marketHashName] = { at: now, rows };
      applyHeat(item, rows);
    } catch {
      applyHeat(item, []);
    }
  }

  const done = new Set(ranked.map((x) => x.marketHashName));
  for (const item of listings) {
    if (done.has(item.marketHashName)) continue;
    applyHeat(item, cache[item.marketHashName]?.rows ?? []);
  }
  saveCache(cache);
  return listings;
}

function sum(rows: HistRow[], key: "last_7_days" | "last_30_days") {
  let vol = 0;
  let avgW = 0;
  let weight = 0;
  for (const row of rows) {
    const b = row[key];
    if (!b || !b.volume || b.avg == null) continue;
    vol += b.volume;
    avgW += b.avg * b.volume;
    weight += b.volume;
  }
  return { vol, avg: weight ? avgW / weight : null };
}

function rowsFor(listing: Listing, rows: HistRow[]) {
  const v = (listing.version ?? "").trim().toLowerCase();
  if (!v) return rows;
  const hit = rows.filter((r) => (r.version ?? "").trim().toLowerCase() === v);
  return hit.length ? hit : rows;
}

export function applyHeat(listing: Listing, rows: HistRow[]) {
  const why: string[] = [];
  let score = 0;
  const { minPrice, medianPrice, suggestedPrice, quantity, patternTag } = listing;
  rows = rowsFor(listing, rows);

  if (quantity > 0 && quantity <= 5) {
    score += 16;
    why.push("thin book");
  } else if (quantity >= 6 && quantity <= 12) {
    score += 8;
    why.push("tight book");
  }

  if (minPrice && medianPrice && medianPrice > 0) {
    const ratio = minPrice / medianPrice;
    if (ratio >= 0.92 && ratio <= 1.08) {
      score += 12;
      why.push("ask hugs median");
    } else if (ratio >= 0.62 && ratio < 0.88) {
      score += 15;
      why.push("dip under median");
    }
  }

  if (minPrice && suggestedPrice && suggestedPrice > 0 && minPrice >= suggestedPrice * 0.97) {
    score += 8;
    why.push("firm vs suggested");
  }

  const d7 = sum(rows, "last_7_days");
  const d30 = sum(rows, "last_30_days");
  if (d7.avg && d30.avg && d30.avg > 0) {
    const trend = (d7.avg - d30.avg) / d30.avg;
    if (trend > 0.03) {
      score += Math.min(30, Math.round(trend * 180));
      why.push(`7d +${(trend * 100).toFixed(1)}% vs 30d`);
    } else if (trend < -0.08) {
      score -= 10;
      why.push("7d fading");
    }
  }
  if (d7.vol > 0 && d30.vol > 0 && d7.vol >= d30.vol * 0.32) {
    score += 12;
    why.push("volume up");
  }
  if (patternTag) {
    score += 10;
    why.push(patternTag);
  }

  listing.heatScore = Math.max(0, Math.min(99, score));
  listing.heatWhy = why.join(" · ") || "quiet tape";
}

export function isHot(listing: Listing, min: number) {
  return (listing.heatScore ?? 0) >= min;
}
