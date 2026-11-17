import type { Listing } from "../../entities/listing.js";
import { imagePath } from "../../lib/skin-image.js";

type SkinportItem = {
  market_hash_name: string;
  version?: string | null;
  min_price: number | null;
  suggested_price: number | null;
  quantity: number;
  mean_price?: number | null;
  median_price?: number | null;
  max_price?: number | null;
  item_page?: string;
  market_page?: string;
};

const ua = {
  accept: "application/json",
  "accept-encoding": "gzip, deflate, br",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SkinDesk/0.2",
};

export type HistoryBucket = {
  avg: number | null;
  median: number | null;
  volume: number;
};

export type HistoryRow = {
  marketHashName: string;
  last7?: HistoryBucket;
  last30?: HistoryBucket;
  last90?: HistoryBucket;
};

function bucket(raw: { avg?: number | null; median?: number | null; volume?: number } | undefined): HistoryBucket | undefined {
  if (!raw) return undefined;
  return {
    avg: raw.avg ?? null,
    median: raw.median ?? null,
    volume: raw.volume ?? 0,
  };
}

export async function fetchSkinportHistory(currency: string): Promise<HistoryRow[]> {
  const url = new URL("https://api.skinport.com/v1/sales/history");
  url.searchParams.set("app_id", "730");
  url.searchParams.set("currency", currency);
  const res = await fetch(url, { headers: ua });
  if (!res.ok) throw new Error(`skinport history ${res.status}`);
  const rows = (await res.json()) as Array<{
    market_hash_name?: string;
    last_7_days?: { avg?: number | null; median?: number | null; volume?: number };
    last_30_days?: { avg?: number | null; median?: number | null; volume?: number };
    last_90_days?: { avg?: number | null; median?: number | null; volume?: number };
  }>;
  return rows
    .filter((row) => row.market_hash_name)
    .map((row) => ({
      marketHashName: row.market_hash_name as string,
      last7: bucket(row.last_7_days),
      last30: bucket(row.last_30_days),
      last90: bucket(row.last_90_days),
    }));
}

function itemKey(row: SkinportItem) {
  return `${row.market_hash_name}\t${row.version?.trim() ?? ""}`;
}

function openUrl(row: SkinportItem) {
  return (
    row.item_page ||
    row.market_page ||
    `https://skinport.com/market?search=${encodeURIComponent(row.market_hash_name)}`
  );
}

async function pullItems(currency: string, tradable: boolean): Promise<SkinportItem[]> {
  const url = new URL("https://api.skinport.com/v1/items");
  url.searchParams.set("app_id", "730");
  url.searchParams.set("currency", currency);
  url.searchParams.set("tradable", tradable ? "1" : "0");
  const res = await fetch(url, { headers: ua });
  if (!res.ok) throw new Error(`skinport ${res.status}`);
  return (await res.json()) as SkinportItem[];
}

function toListing(row: SkinportItem, extra: Partial<Listing> = {}): Listing {
  return {
    marketHashName: row.market_hash_name,
    version: row.version?.trim() || undefined,
    minPrice: row.min_price,
    suggestedPrice: row.suggested_price,
    quantity: row.quantity ?? 0,
    meanPrice: row.mean_price,
    medianPrice: row.median_price,
    maxPrice: row.max_price,
    url: openUrl(row),
    image: imagePath(row.market_hash_name, row.version),
    source: "skinport",
    ...extra,
  };
}

export async function fetchSkinport(currency: string): Promise<Listing[]> {
  const heldRows = await pullItems(currency, false);
  let liveRows: SkinportItem[] = [];
  try {
    liveRows = await pullItems(currency, true);
  } catch (err) {
    console.error(err);
  }
  const held = new Map(heldRows.map((row) => [itemKey(row), row]));
  const live = new Map(liveRows.map((row) => [itemKey(row), row]));
  const out: Listing[] = [];
  for (const key of new Set([...held.keys(), ...live.keys()])) {
    const unlocked = live.get(key);
    const locked = held.get(key);
    const row = unlocked ?? locked;
    if (!row) continue;
    if (row.min_price == null && (row.quantity ?? 0) <= 0) continue;
    const minLive = unlocked?.min_price ?? null;
    const minHold = locked?.min_price ?? null;
    const onHold = !unlocked && minHold != null;
    out.push(
      toListing(row, {
        minLive,
        minHold: minHold != null && minLive != null && minHold < minLive - 0.49 ? minHold : onHold ? minHold : null,
        onHold,
      }),
    );
  }
  return out;
}
