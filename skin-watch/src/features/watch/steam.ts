import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../../shared/config.js";
import type { Listing, Quote } from "../../entities/listing.js";
import { imagePath } from "../../lib/skin-image.js";

type SteamRow = {
  lowest: number | null;
  median: number | null;
  volume: number | null;
  at: number;
};

const TTL = 20 * 60 * 1000;
const ua = {
  accept: "application/json",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SkinDesk/0.2",
  referer: "https://steamcommunity.com/market/",
};

function cacheFile() {
  mkdirSync(config.dataDir, { recursive: true });
  return join(config.dataDir, "steam.json");
}

function loadCache(): Record<string, SteamRow> {
  if (!existsSync(cacheFile())) return {};
  try {
    return JSON.parse(readFileSync(cacheFile(), "utf8")) as Record<string, SteamRow>;
  } catch {
    return {};
  }
}

function usd(raw: string | undefined) {
  if (!raw) return null;
  const n = Number(raw.replace(/,/g, "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function marketUrl(name: string) {
  return `https://steamcommunity.com/market/listings/730/${encodeURIComponent(name)}`;
}

async function pull(name: string): Promise<SteamRow> {
  const url = new URL("https://steamcommunity.com/market/priceoverview/");
  url.searchParams.set("appid", "730");
  url.searchParams.set("currency", "1");
  url.searchParams.set("market_hash_name", name);
  const res = await fetch(url, { headers: ua });
  if (res.status === 429) throw new Error("steam 429");
  if (!res.ok) return { lowest: null, median: null, volume: null, at: Date.now() };
  const row = (await res.json()) as {
    success?: boolean;
    lowest_price?: string;
    median_price?: string;
    volume?: string;
  };
  if (!row.success) return { lowest: null, median: null, volume: null, at: Date.now() };
  return {
    lowest: usd(row.lowest_price),
    median: usd(row.median_price),
    volume: row.volume ? Number(String(row.volume).replace(/,/g, "")) : null,
    at: Date.now(),
  };
}

export async function fetchSteamQuotes(names: string[]): Promise<Map<string, SteamRow>> {
  const cache = loadCache();
  const now = Date.now();
  const out = new Map<string, SteamRow>();
  let fresh = 0;
  for (const name of names) {
    const hit = cache[name];
    if (hit && now - hit.at < TTL) {
      out.set(name, hit);
      continue;
    }
    if (fresh >= config.steamPerTick) continue;
    try {
      const row = await pull(name);
      cache[name] = row;
      out.set(name, row);
      fresh += 1;
      await new Promise((r) => setTimeout(r, 150));
    } catch (err) {
      console.error(err);
      if (hit) out.set(name, hit);
      break;
    }
  }
  writeFileSync(cacheFile(), JSON.stringify(cache));
  return out;
}

export function steamQuote(name: string, row: SteamRow): Quote | null {
  if (row.lowest == null) return null;
  return { source: "steam", price: row.lowest, url: marketUrl(name), qty: row.volume ?? undefined };
}

export function steamListing(name: string, row: SteamRow, suggested: number | null): Listing | null {
  if (row.lowest == null) return null;
  return {
    marketHashName: name,
    minPrice: row.lowest,
    suggestedPrice: suggested ?? row.median,
    medianPrice: row.median,
    meanPrice: row.median,
    quantity: row.volume && row.volume > 0 ? Math.min(99, row.volume) : 1,
    url: marketUrl(name),
    image: imagePath(name),
    source: "steam",
  };
}
