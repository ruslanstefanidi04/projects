import type { Listing } from "../../entities/listing.js";
import { matchesWatch } from "../../entities/listing.js";
import { config } from "../../shared/config.js";
import { imagePath } from "../../lib/skin-image.js";

type FloatRow = {
  id?: string | number;
  price?: number;
  item?: {
    market_hash_name?: string;
    float_value?: number;
    paint_seed?: number;
    phase?: string;
    fade?: number | { percentage?: number };
  };
};

function parseBody(body: unknown): FloatRow[] {
  if (Array.isArray(body)) return body as FloatRow[];
  if (body && typeof body === "object" && Array.isArray((body as { data?: FloatRow[] }).data)) {
    return (body as { data: FloatRow[] }).data;
  }
  return [];
}

function fadePctOf(item: FloatRow["item"]): number | undefined {
  const raw = item?.fade;
  if (typeof raw === "number" && raw > 0) return raw;
  if (raw && typeof raw === "object" && typeof raw.percentage === "number") return raw.percentage;
  return undefined;
}

async function pull(sort: string, extra: Record<string, string> = {}): Promise<FloatRow[]> {
  const url = new URL("https://csfloat.com/api/v1/listings");
  url.searchParams.set("limit", "50");
  url.searchParams.set("sort_by", sort);
  url.searchParams.set("type", "buy_now");
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": "Vault/0.5",
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
  const fv = row.item?.float_value;
  const fadePct = fadePctOf(row.item);
  const phase = row.item?.phase?.trim();
  const sp = catalog.find((x) => x.source === "skinport" && x.marketHashName === name);
  const id = row.id != null ? String(row.id) : "";
  return {
    marketHashName: name,
    minPrice: cents / 100,
    suggestedPrice: sp?.suggestedPrice ?? null,
    medianPrice: sp?.medianPrice ?? null,
    meanPrice: sp?.meanPrice ?? null,
    quantity: 1,
    url: id ? `https://csfloat.com/item/${id}` : `https://csfloat.com/search?market_hash_name=${encodeURIComponent(name)}`,
    image: sp?.image || imagePath(name, phase),
    source: "csfloat",
    floatValue: fv,
    fadePct,
    paintSeed: row.item?.paint_seed,
    version: phase || (fadePct != null && fadePct >= 97 ? `fade ${fadePct.toFixed(1)}` : undefined),
    sellVenue: "skinport",
    sellUrl: sp?.url,
    sellAsk: sp?.minPrice,
    sellQty: sp?.quantity,
  };
}

export async function attachFloatListings(listings: Listing[], watch: string[]): Promise<Listing[]> {
  const jobs = [
    pull("lowest_float", { max_float: "0.01" }),
    pull("highest_float", { min_float: "0.98" }),
    pull("lowest_price", { min_fade: "97" }),
  ];
  const packs = await Promise.all(
    jobs.map((p) =>
      p.catch((err) => {
        console.error(err);
        return [] as FloatRow[];
      }),
    ),
  );
  const seen = new Set<string>();
  const extra: Listing[] = [];
  for (const rows of packs) {
    for (const row of rows) {
      const card = toListing(row, listings);
      if (!card) continue;
      if (!matchesWatch(card.marketHashName, watch)) continue;
      const key = `${card.url}\t${card.marketHashName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      extra.push(card);
    }
  }
  return extra.length ? [...listings, ...extra] : listings;
}
