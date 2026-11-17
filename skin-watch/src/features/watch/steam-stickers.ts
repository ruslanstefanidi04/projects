import type { Listing } from "../../entities/listing.js";
import { matchesWatch } from "../../entities/listing.js";
import { imagePath } from "../../lib/skin-image.js";
import { config } from "../../shared/config.js";
import type { StickerBit } from "./stickers.js";

const ua = {
  accept: "application/json, text/javascript, */*; q=0.01",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  referer: "https://steamcommunity.com/market/",
};

const HOSTS = [
  "Glock-18 | High Beam (Factory New)",
  "P250 | Sand Dune (Field-Tested)",
  "Tec-9 | Army Mesh (Field-Tested)",
  "Nova | Predator (Field-Tested)",
  "MP9 | Sand Scale (Field-Tested)",
  "FAMAS | Colony (Field-Tested)",
  "UMP-45 | Scorched (Field-Tested)",
  "AK-47 | Safari Mesh (Field-Tested)",
];

type SteamListing = {
  listingid?: string;
  converted_price?: number;
  converted_fee?: number;
  asset?: { id?: string; contextid?: string; appid?: number };
};

type SteamAsset = {
  id?: string;
  market_hash_name?: string;
  descriptions?: Array<{ value?: string }>;
  market_actions?: Array<{ link?: string }>;
};

function stickersFromHtml(html: string): string[] {
  const plain = html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ");
  const line = plain.match(/Stickers?:\s*([^\n]+)/i);
  if (!line) return [];
  return line[1]
    .split(/,\s*/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 2 && s.length < 90);
}

function bits(names: string[]): StickerBit[] {
  return names.map((raw) => {
    const name = raw.toLowerCase().startsWith("sticker |") ? raw : `Sticker | ${raw}`;
    return { name, usd: 0 };
  });
}

function usdOf(row: SteamListing) {
  const cents = (row.converted_price ?? 0) + (row.converted_fee ?? 0);
  if (cents <= 0) return null;
  return cents / 100;
}

function cardsFromPayload(body: {
  listinginfo?: Record<string, SteamListing>;
  assets?: Record<string, Record<string, Record<string, SteamAsset>>>;
}): Listing[] {
  const out: Listing[] = [];
  const listinginfo = body.listinginfo ?? {};
  const bag = body.assets?.["730"] ?? {};
  for (const row of Object.values(listinginfo)) {
    const aid = row.asset?.id;
    const ctx = String(row.asset?.contextid ?? "2");
    if (!aid) continue;
    const asset = bag[ctx]?.[aid];
    const name = asset?.market_hash_name;
    const price = usdOf(row);
    if (!name || price == null) continue;
    const html = (asset.descriptions ?? []).map((d) => d.value ?? "").join("\n");
    const names = stickersFromHtml(html);
    if (!names.length) continue;
    const id = row.listingid ?? "";
    out.push({
      marketHashName: name,
      minPrice: price,
      suggestedPrice: null,
      quantity: 1,
      url: id
        ? `https://steamcommunity.com/market/listings/730/${encodeURIComponent(name)}#listing_${id}`
        : `https://steamcommunity.com/market/listings/730/${encodeURIComponent(name)}`,
      image: imagePath(name),
      source: "steam",
      stickers: bits(names),
    });
  }
  return out;
}

async function getJson(url: string) {
  const res = await fetch(url, { headers: ua });
  if (!res.ok) return null;
  const text = await res.text();
  if (!text || text.trimStart().startsWith("<")) return null;
  try {
    return JSON.parse(text) as {
      listinginfo?: Record<string, SteamListing>;
      assets?: Record<string, Record<string, Record<string, SteamAsset>>>;
      success?: boolean;
    };
  } catch {
    return null;
  }
}

async function pullRecent(): Promise<Listing[]> {
  const body = await getJson("https://steamcommunity.com/market/recent?country=US&language=english&currency=1");
  if (!body) return [];
  return cardsFromPayload(body).filter((x) => !x.marketHashName.toLowerCase().startsWith("sticker |"));
}

async function pullName(name: string): Promise<Listing[]> {
  const url = new URL(`https://steamcommunity.com/market/listings/730/${encodeURIComponent(name)}/render/`);
  url.searchParams.set("start", "0");
  url.searchParams.set("count", "10");
  url.searchParams.set("currency", "1");
  url.searchParams.set("language", "english");
  const body = await getJson(url.toString());
  if (!body || body.success === false) return [];
  return cardsFromPayload(body);
}

function hosts(catalog: Listing[]) {
  const cheap = catalog
    .filter((row) => {
      if (row.source !== "skinport" || row.minPrice == null || row.minPrice > 25) return false;
      return matchesWatch(row.marketHashName, ["rifles", "pistols", "smgs"]);
    })
    .sort((a, b) => (a.minPrice ?? 0) - (b.minPrice ?? 0))
    .map((row) => row.marketHashName)
    .slice(0, 4);
  return [...new Set([...HOSTS, ...cheap])].slice(0, 8);
}

export async function fetchSteamStickerCrafts(catalog: Listing[], watch: string[]): Promise<Listing[]> {
  const extra: Listing[] = [];
  const seen = new Set<string>();
  const add = (rows: Listing[]) => {
    for (const row of rows) {
      if (!matchesWatch(row.marketHashName, watch)) continue;
      const key = `${row.url}\t${row.marketHashName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sug = catalog.find((x) => x.source === "skinport" && x.marketHashName === row.marketHashName);
      extra.push({
        ...row,
        suggestedPrice: row.suggestedPrice ?? sug?.suggestedPrice ?? null,
      });
    }
  };
  try {
    add(await pullRecent());
    for (const name of hosts(catalog)) {
      add(await pullName(name));
      await new Promise((r) => setTimeout(r, 180));
    }
  } catch (err) {
    console.error(err);
  }
  return extra;
}
