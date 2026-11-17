import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { honestSkinportSale, type Listing, type Quote } from "../../entities/listing.js";
import { config } from "../../shared/config.js";
import { readJson, writeJson } from "../../shared/persist.js";

type Cached = { quotes: Quote[]; at: number };
type DumpFile = { at: number; rows: Record<string, Quote[]> };

const TTL = 15 * 60 * 1000;
const ua = {
  accept: "application/json",
  "user-agent": "SkinDesk/0.4",
};

const AIM_QUERY =
  "query ApiBotsInventoryCountAndMinPrice($where: BotsInventoryWhereInput!, $currency: CurrencySymbolEnum) { bots_inventory_count_and_min_price(where: $where, currency: $currency) { marketHashName count price { sellPrice currency } } }";

function cacheFile() {
  mkdirSync(config.dataDir, { recursive: true });
  return join(config.dataDir, "quotes.json");
}

function dumpFile() {
  mkdirSync(config.dataDir, { recursive: true });
  return join(config.dataDir, "dumps.json");
}

function loadCache(): Record<string, Cached> {
  if (!existsSync(cacheFile())) return {};
  try {
    return JSON.parse(readFileSync(cacheFile(), "utf8")) as Record<string, Cached>;
  } catch {
    return {};
  }
}

function cents(n: unknown) {
  const v = typeof n === "string" ? Number(n) : typeof n === "number" ? n : NaN;
  if (!Number.isFinite(v) || v <= 0) return null;
  return v >= 100 ? v / 100 : v;
}

function dollars(n: unknown) {
  const v = typeof n === "string" ? Number(n) : typeof n === "number" ? n : NaN;
  if (!Number.isFinite(v) || v <= 0) return null;
  return v;
}

function parseFloatRows(body: unknown): Array<{ id?: string | number; price?: number }> {
  if (Array.isArray(body)) return body as Array<{ id?: string | number; price?: number }>;
  if (body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)) {
    return (body as { data: Array<{ id?: string | number; price?: number }> }).data;
  }
  return [];
}

function versionFromAim(aimName: string, hash: string) {
  if (aimName === hash) return undefined;
  const prefix = `${hash} - `;
  if (aimName.startsWith(prefix)) return aimName.slice(prefix.length).trim() || undefined;
  return undefined;
}

async function jsonGet(url: string, ms = 12000): Promise<unknown | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { headers: ua, signal: ac.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error(err);
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function csfloatQuote(name: string): Promise<Quote | null> {
  const url = new URL("https://csfloat.com/api/v1/listings");
  url.searchParams.set("market_hash_name", name);
  url.searchParams.set("sort_by", "lowest_price");
  url.searchParams.set("type", "buy_now");
  url.searchParams.set("limit", "1");
  const headers: Record<string, string> = { ...ua };
  if (config.csfloatKey) headers.authorization = config.csfloatKey;
  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  const row = parseFloatRows(await res.json())[0];
  if (!row || row.price == null) return null;
  const price = row.price / 100;
  if (!(price > 0)) return null;
  const id = row.id != null ? String(row.id) : "";
  return {
    source: "csfloat",
    price,
    url: id
      ? `https://csfloat.com/item/${id}`
      : `https://csfloat.com/search?market_hash_name=${encodeURIComponent(name)}`,
  };
}

async function dmarketQuote(name: string): Promise<Quote | null> {
  const url = new URL("https://api.dmarket.com/exchange/v1/market/items");
  url.searchParams.set("gameId", "a8db");
  url.searchParams.set("currency", "USD");
  url.searchParams.set("limit", "1");
  url.searchParams.set("orderBy", "price");
  url.searchParams.set("orderDir", "asc");
  url.searchParams.set("side", "market");
  url.searchParams.set("title", name);
  const res = await fetch(url, { headers: ua });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    objects?: Array<{ itemId?: string; extra?: { name?: string }; price?: { USD?: string } }>;
  };
  const row = (body.objects ?? []).find((x) => !x.extra?.name || x.extra.name === name) ?? body.objects?.[0];
  const price = cents(row?.price?.USD);
  if (!row || price == null) return null;
  const id = row.itemId ?? "";
  return {
    source: "dmarket",
    price,
    url: id
      ? `https://dmarket.com/ingame-items/item-list/csgo-skins/${id}`
      : `https://dmarket.com/ingame-items/item-list/csgo-skins?title=${encodeURIComponent(name)}`,
  };
}

async function aimQuotes(name: string): Promise<Quote[]> {
  const res = await fetch("https://aim.market/v1/api/graphql", {
    method: "POST",
    headers: { ...ua, "content-type": "application/json" },
    body: JSON.stringify({
      operationName: "ApiBotsInventoryCountAndMinPrice",
      query: AIM_QUERY,
      variables: { currency: "USD", where: { marketHashName: { _text: name } } },
    }),
  });
  if (!res.ok) return [];
  const body = (await res.json()) as {
    data?: { bots_inventory_count_and_min_price?: Array<{ marketHashName?: string; count?: number; price?: { sellPrice?: number } }> };
  };
  const out: Quote[] = [];
  for (const row of body.data?.bots_inventory_count_and_min_price ?? []) {
    const aimName = row.marketHashName ?? "";
    if (aimName !== name && !aimName.startsWith(`${name} - `)) continue;
    const price = dollars(row.price?.sellPrice);
    if (price == null) continue;
    const version = versionFromAim(aimName, name);
    out.push({
      source: "aim",
      price: Math.round(price * 100) / 100,
      qty: row.count,
      version,
      url: `https://aim.market/en/buy/csgo/${encodeURIComponent(aimName)}`,
    });
  }
  return out;
}

async function skinsQuote(name: string): Promise<Quote | null> {
  const url = new URL("https://api.skins.com/public/market/order-book");
  url.searchParams.set("marketHashName", name);
  const body = (await jsonGet(url.toString())) as {
    data?: { listings?: Array<{ price?: number; quantity?: number }> };
  } | null;
  const lot = body?.data?.listings?.[0];
  const price = dollars(lot?.price);
  if (price == null) return null;
  return {
    source: "skins",
    price,
    qty: lot?.quantity,
    url: `https://skins.com/?search=${encodeURIComponent(name)}`,
  };
}

async function skinplaceQuote(name: string): Promise<Quote | null> {
  const url = new URL("https://api.skin.place/api/v3/items");
  url.searchParams.set("project", "csgo");
  url.searchParams.set("search", name);
  const body = (await jsonGet(url.toString())) as {
    data?: Array<{
      steam_market_hash_name?: string;
      steam_url_name?: string;
      markets_price?: { min_price?: string | number };
    }>;
  } | null;
  const row = (body?.data ?? []).find((x) => x.steam_market_hash_name === name);
  const price = dollars(row?.markets_price?.min_price);
  if (price == null) return null;
  const slug = row?.steam_url_name;
  return {
    source: "skinplace",
    price,
    url: slug
      ? `https://skin.place/en/${slug}`
      : `https://skin.place/?search=${encodeURIComponent(name)}`,
  };
}

function pushDump(book: Record<string, Quote[]>, q: Quote, name: string) {
  if (!name) return;
  const cur = book[name] ?? [];
  if (cur.some((x) => x.source === q.source)) return;
  book[name] = [...cur, q];
}

async function pullDumps(names: string[]): Promise<Record<string, Quote[]>> {
  const want = new Set(names);
  const take = (hit: DumpFile) => Object.fromEntries(names.map((n) => [n, hit.rows[n] ?? []]));
  if (existsSync(dumpFile())) {
    try {
      const hit = JSON.parse(readFileSync(dumpFile(), "utf8")) as DumpFile;
      if (Date.now() - hit.at < config.dumpTtlMs) return take(hit);
    } catch {
      /* ignore */
    }
  }
  const remote = await readJson<DumpFile>("dumps.json");
  if (remote && Date.now() - remote.at < config.dumpTtlMs) {
    writeFileSync(dumpFile(), JSON.stringify(remote));
    return take(remote);
  }
  const book: Record<string, Quote[]> = {};
  const [wax, lis, tm, white] = await Promise.all([
    jsonGet("https://api.waxpeer.com/v1/prices?game=csgo"),
    jsonGet("https://lis-skins.com/market_export_json/csgo.json"),
    jsonGet("https://market.csgo.com/api/v2/prices/USD.json"),
    jsonGet("https://export.white.market/v1/prices/730.json", 45000),
  ]);

  const waxItems = (wax as { items?: Array<{ name?: string; min?: number; count?: number }> } | null)?.items ?? [];
  for (const row of waxItems) {
    const name = row.name ?? "";
    if (!want.has(name)) continue;
    const price = row.min != null ? row.min / 100 : null;
    if (price == null || !(price > 0)) continue;
    pushDump(book, {
      source: "waxpeer",
      price,
      qty: row.count,
      url: `https://waxpeer.com/?game=csgo&search=${encodeURIComponent(name)}`,
    }, name);
  }

  const lisRows = Array.isArray(lis)
    ? (lis as Array<{ name?: string; price?: number; unlocked_price?: number; url?: string; count?: number }>)
    : [];
  for (const row of lisRows) {
    const name = row.name ?? "";
    if (!want.has(name)) continue;
    const price = dollars(row.unlocked_price ?? row.price);
    if (price == null) continue;
    pushDump(book, {
      source: "lis",
      price,
      qty: row.count,
      url: row.url || `https://lis-skins.com/market/csgo/?search=${encodeURIComponent(name)}`,
    }, name);
  }

  const tmRows = (tm as { items?: Array<{ market_hash_name?: string; price?: string; volume?: string }> } | null)?.items ?? [];
  for (const row of tmRows) {
    const name = row.market_hash_name ?? "";
    if (!want.has(name)) continue;
    const price = dollars(row.price);
    if (price == null) continue;
    pushDump(book, {
      source: "csgotm",
      price,
      qty: row.volume ? Number(row.volume) : undefined,
      url: `https://market.csgo.com/en/?search=${encodeURIComponent(name)}`,
    }, name);
  }

  const whiteRows = Array.isArray(white)
    ? (white as Array<{
        market_hash_name?: string;
        price?: string | number;
        market_product_link?: string;
        market_product_count?: number;
      }>)
    : [];
  for (const row of whiteRows) {
    const name = row.market_hash_name ?? "";
    if (!want.has(name)) continue;
    const price = dollars(row.price);
    if (price == null) continue;
    pushDump(book, {
      source: "white",
      price,
      qty: row.market_product_count,
      url: row.market_product_link || `https://white.market/item?appId=730&nameHash=${encodeURIComponent(name)}`,
    }, name);
  }

  const snap = { at: Date.now(), rows: book };
  await writeJson("dumps.json", snap);
  return Object.fromEntries(names.map((n) => [n, book[n] ?? []]));
}

function quoteFits(q: Quote, listing: Listing) {
  if (!q.version) return true;
  const v = (listing.version ?? "").trim().toLowerCase();
  if (!v) return false;
  return q.version.trim().toLowerCase() === v;
}

async function liveQuotes(name: string): Promise<Quote[]> {
  const rows = await Promise.all([
    csfloatQuote(name).catch(() => null),
    dmarketQuote(name).catch(() => null),
    skinsQuote(name).catch(() => null),
    skinplaceQuote(name).catch(() => null),
    aimQuotes(name).catch((err) => {
      console.error(err);
      return [] as Quote[];
    }),
  ]);
  const out: Quote[] = [];
  for (const row of rows) {
    if (!row) continue;
    if (Array.isArray(row)) out.push(...row);
    else out.push(row);
  }
  return out;
}

async function hydrateQuoteCache(): Promise<Record<string, Cached>> {
  const local = loadCache();
  if (Object.keys(local).length) return local;
  const remote = await readJson<Record<string, Cached>>("quotes.json");
  if (!remote || typeof remote !== "object") return local;
  writeFileSync(cacheFile(), JSON.stringify(remote));
  return remote;
}

export async function fetchMarketQuotes(names: string[]): Promise<Map<string, Quote[]>> {
  const dumps = await pullDumps(names).catch((err) => {
    console.error(err);
    return {} as Record<string, Quote[]>;
  });
  const cache = await hydrateQuoteCache();
  const now = Date.now();
  const out = new Map<string, Quote[]>();
  for (const name of names) {
    out.set(name, dumps[name] ?? []);
  }
  let fresh = 0;
  for (const name of names) {
    const hit = cache[name];
    if (hit && now - hit.at < TTL) {
      const cur = out.get(name) ?? [];
      const rest = hit.quotes.filter((q) => !cur.some((x) => x.source === q.source && x.version === q.version));
      out.set(name, [...cur, ...rest]);
      continue;
    }
    if (fresh >= config.quotePerTick) continue;
    try {
      const live = await liveQuotes(name);
      cache[name] = { quotes: live, at: Date.now() };
      const cur = out.get(name) ?? [];
      out.set(name, [...cur, ...live.filter((q) => !cur.some((x) => x.source === q.source && x.version === q.version))]);
      fresh += 1;
    } catch (err) {
      console.error(err);
      if (hit) {
        const cur = out.get(name) ?? [];
        out.set(name, [...cur, ...hit.quotes]);
      }
      break;
    }
  }
  writeFileSync(cacheFile(), JSON.stringify(cache));
  void writeJson("quotes.json", cache);
  return out;
}

export function applyQuotes(listings: Listing[], book: Map<string, Quote[]>) {
  for (const row of listings) {
    const extra = (book.get(row.marketHashName) ?? []).filter((q) => quoteFits(q, row));
    if (!extra.length) continue;
    const keep = (row.quotes ?? []).filter((q) => !extra.some((x) => x.source === q.source && x.version === q.version));
    row.quotes = [...keep, ...extra];
  }
}

function sameVersion(a?: string, b?: string) {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

function needsVersion(name: string) {
  return /doppler|gamma doppler|marble fade|fade \(|case hardened|crimson web/i.test(name);
}

export function quoteListings(listings: Listing[], book: Map<string, Quote[]>): Listing[] {
  const extra: Listing[] = [];
  const seen = new Set<string>();
  for (const [name, quotes] of book) {
    for (const q of quotes) {
      if (q.source === "waxpeer" || q.source === "lis" || q.source === "csgotm" || q.source === "white") continue;
      const key = `${q.source}\t${name}\t${q.version ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (needsVersion(name) && !q.version) continue;
      const sp = listings.find(
        (r) =>
          r.source === "skinport" &&
          r.marketHashName === name &&
          sameVersion(r.version, q.version || r.version),
      );
      if (q.version && !sp) continue;
      if (!sp || sp.minPrice == null) continue;
      if (q.price >= sp.minPrice * 0.97) continue;
      const sale = honestSkinportSale({
        ...sp,
        source: q.source,
        minPrice: q.price,
        sellAsk: sp.minPrice,
        sellQty: sp.quantity,
      });
      if (!sale && (sp.quantity ?? 0) <= 2) continue;
      extra.push({
        marketHashName: name,
        minPrice: q.price,
        suggestedPrice: sp.suggestedPrice,
        medianPrice: sp.medianPrice,
        meanPrice: sp.meanPrice,
        quantity: q.qty ?? 1,
        url: q.url,
        image: sp.image ?? "",
        source: q.source,
        version: q.version ?? sp.version,
        sellVenue: "skinport",
        sellUrl: sp.url,
        sellAsk: sp.minPrice,
        sellQty: sp.quantity,
      });
    }
  }
  return extra;
}
