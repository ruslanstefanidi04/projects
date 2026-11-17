import type { Listing } from "../../entities/listing.js";
import { matchesWatch } from "../../entities/listing.js";
import { config } from "../../shared/config.js";
import { fetchSteamStickerCrafts } from "./steam-stickers.js";

export type StickerBit = { name: string; usd: number; wear?: number };

const FAMOUS =
  /katowice 2014|howling dawn|crown \(foil\)|ibuyPOWER|reason gaming|titan \(holo\)|vox eminor \(holo\)|3dmax \(holo\)|clan-mystik \(holo\)/i;

const HOT_IDS = [76, 59, 103, 73];

function applyRate(name: string) {
  const n = name.toLowerCase();
  if (n.includes("katowice 2014") || n.includes("howling dawn")) return 0.22;
  if (n.includes("crown (foil)")) return 0.12;
  return 0.08;
}

export function isFamousSticker(name: string) {
  return FAMOUS.test(name);
}

export function stickerBook(listings: Listing[]) {
  const m = new Map<string, number>();
  for (const row of listings) {
    const name = row.marketHashName;
    if (!name.toLowerCase().startsWith("sticker |")) continue;
    if (row.minPrice == null || row.minPrice <= 0) continue;
    const prev = m.get(name);
    if (prev == null || row.minPrice < prev) m.set(name, row.minPrice);
  }
  return m;
}

export function craftScore(bits: StickerBit[]) {
  let loose = 0;
  let expect = 0;
  let famous = 0;
  for (const bit of bits) {
    loose += bit.usd;
    expect += bit.usd * applyRate(bit.name);
    if (isFamousSticker(bit.name)) famous += 1;
  }
  return { loose, expect, famous };
}

export function tagStickers(listing: Listing, book: Map<string, number>, nakedMin: number | null): Listing {
  const bits = (listing.stickers ?? []).map((s) => ({
    ...s,
    usd: s.usd > 0 ? s.usd : book.get(s.name) ?? 0,
  }));
  if (!bits.length) {
    if (listing.marketHashName.toLowerCase().startsWith("sticker |") && isFamousSticker(listing.marketHashName)) {
      return { ...listing, stickerWhy: "loose sticker", stickerValue: listing.minPrice ?? 0 };
    }
    return listing;
  }
  const { loose, expect, famous } = craftScore(bits);
  const price = listing.minPrice ?? 0;
  const crazy = famous > 0;
  const cheapCraft = expect >= config.stickerMinUsd && (nakedMin == null || price < nakedMin + expect * 0.7);
  if (!crazy && !cheapCraft) return listing;
  const names = bits
    .filter((b) => isFamousSticker(b.name) || b.usd >= 40)
    .map((b) => b.name.replace(/^sticker \| /i, ""))
    .slice(0, 4);
  const why = crazy
    ? `craft ${names.join(" · ") || "hot stickers"}`
    : `stickers ~${Math.round(expect)} overpay vs gun`;
  return { ...listing, stickers: bits, stickerValue: Math.round(loose), stickerWhy: why };
}

type FloatRow = {
  id?: string | number;
  price?: number;
  item?: {
    market_hash_name?: string;
    float_value?: number;
    paint_seed?: number;
    phase?: string;
    stickers?: Array<{
      name?: string;
      wear?: number;
      scm?: { price?: number };
    }>;
  };
};

function parseBody(body: unknown): FloatRow[] {
  if (Array.isArray(body)) return body as FloatRow[];
  if (body && typeof body === "object" && Array.isArray((body as { data?: FloatRow[] }).data)) {
    return (body as { data: FloatRow[] }).data;
  }
  return [];
}

async function pull(sort: string, extra: Record<string, string> = {}): Promise<FloatRow[]> {
  const url = new URL("https://csfloat.com/api/v1/listings");
  url.searchParams.set("limit", "40");
  url.searchParams.set("sort_by", sort);
  url.searchParams.set("type", "buy_now");
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": "SkinDesk/0.2",
  };
  if (config.csfloatKey) headers.authorization = config.csfloatKey;
  const res = await fetch(url, { headers });
  if (!res.ok) return [];
  return parseBody(await res.json());
}

function toListing(row: FloatRow, catalog: Listing[]): Listing | null {
  const name = row.item?.market_hash_name;
  const cents = row.price;
  if (!name || cents == null) return null;
  const bits: StickerBit[] = [];
  for (const s of row.item?.stickers ?? []) {
    if (!s.name) continue;
    bits.push({
      name: s.name,
      usd: (s.scm?.price ?? 0) / 100,
      wear: s.wear,
    });
  }
  if (!bits.length) return null;
  const id = row.id != null ? String(row.id) : "";
  return {
    marketHashName: name,
    minPrice: cents / 100,
    suggestedPrice: catalog.find((x) => x.source === "skinport" && x.marketHashName === name)?.suggestedPrice ?? null,
    quantity: 1,
    url: id ? `https://csfloat.com/item/${id}` : `https://csfloat.com/search?market_hash_name=${encodeURIComponent(name)}`,
    image: catalog.find((x) => x.marketHashName === name)?.image ?? "",
    source: "csfloat",
    floatValue: row.item?.float_value,
    paintSeed: row.item?.paint_seed,
    version: row.item?.phase,
    stickers: bits,
  };
}

export async function attachStickerListings(listings: Listing[], watch: string[]): Promise<Listing[]> {
  const seen = new Set<string>();
  const extra: Listing[] = [];
  const ingest = (rows: FloatRow[]) => {
    for (const row of rows) {
      const card = toListing(row, listings);
      if (!card) continue;
      if (!matchesWatch(card.marketHashName, watch)) continue;
      const key = `${card.url}\t${card.marketHashName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      extra.push(card);
    }
  };

  try {
    for (const card of await fetchSteamStickerCrafts(listings, watch)) {
      const key = `${card.url}\t${card.marketHashName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      extra.push(card);
    }
    ingest(await pull("most_recent"));
    for (const id of HOT_IDS) {
      ingest(await pull("most_recent", { stickers: String(id) }));
    }
  } catch (err) {
    console.error(err);
  }

  return extra.length ? [...listings, ...extra] : listings;
}
