import type { Listing } from "../../entities/listing.js";
import { matchesWatch } from "../../entities/listing.js";
import { config } from "../../shared/config.js";
import { fetchSteamQuotes, steamListing, steamQuote } from "./steam.js";
import { applyQuotes, fetchMarketQuotes, quoteListings } from "./quotes.js";
import { attachStickerListings } from "./stickers.js";
import { attachFloatListings } from "./floats.js";

function pickNames(listings: Listing[], watch: string[]) {
  const watched = listings.filter((row) => matchesWatch(row.marketHashName, watch));
  const scored = new Map<string, number>();
  for (const row of watched) {
    const gem = /^(sapphire|ruby|emerald|black pearl)$/i.test(row.version ?? "") ? 50 : 0;
    const price = row.minPrice ?? 0;
    const prev = scored.get(row.marketHashName) ?? 0;
    scored.set(row.marketHashName, Math.max(prev, gem + Math.log10(price + 1) * 10));
  }
  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}

function cheapestSkinport(listings: Listing[], name: string) {
  let min: number | null = null;
  let suggested: number | null = null;
  for (const row of listings) {
    if (row.source !== "skinport" || row.marketHashName !== name) continue;
    if (row.minPrice != null && (min == null || row.minPrice < min)) min = row.minPrice;
    if (row.suggestedPrice != null) suggested = row.suggestedPrice;
  }
  return { min, suggested };
}

export async function mergeMarkets(listings: Listing[], watch: string[]): Promise<Listing[]> {
  const names = pickNames(listings, watch);
  if (config.steamOn && names.length) {
    const steam = await fetchSteamQuotes(names);
    for (const row of listings) {
      const hit = steam.get(row.marketHashName);
      if (!hit) continue;
      const q = steamQuote(row.marketHashName, hit);
      if (!q) continue;
      const rest = (row.quotes ?? []).filter((x) => x.source !== "steam");
      row.quotes = [...rest, q];
    }
    const extra: Listing[] = [];
    for (const [name, hit] of steam) {
      if (hit.lowest == null) continue;
      const sp = cheapestSkinport(listings, name);
      if (sp.min != null && hit.lowest >= sp.min * 0.92) continue;
      const card = steamListing(name, hit, sp.suggested);
      if (card) extra.push(card);
    }
    listings = [...listings, ...extra];
  }

  if (names.length) {
    const book = await fetchMarketQuotes(names).catch((err) => {
      console.error(err);
      return new Map();
    });
    applyQuotes(listings, book);
    listings = [...listings, ...quoteListings(listings, book)];
  }

  listings = await attachStickerListings(listings, watch).catch((err) => {
    console.error(err);
    return listings;
  });
  listings = await attachFloatListings(listings, watch).catch((err) => {
    console.error(err);
    return listings;
  });
  return listings;
}
