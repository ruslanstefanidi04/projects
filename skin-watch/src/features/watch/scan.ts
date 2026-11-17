import { classify, listingKey, matchesWatch, toAlert, type Alert, type Listing } from "../../entities/listing.js";
import type { RuntimeState } from "../../shared/store.js";
import { isHot } from "./heat.js";
import { matchPattern } from "./patterns.js";
import { stickerBook, tagStickers } from "./stickers.js";

function opts(state: RuntimeState) {
  return {
    spreadPct: state.spreadPct,
    extremePct: state.extremePct,
    snipePct: state.snipePct,
    snipeMaxQty: state.snipeMaxQty,
    floor: state.floor,
  };
}

function stamp(listing: Listing, state: RuntimeState, book: Map<string, number>, naked: Map<string, number>): Listing {
  const tagged = tagStickers(listing, book, naked.get(listing.marketHashName) ?? null);
  if (tagged.stickerWhy) return tagged;
  const hit = matchPattern(listing, state.patternNames, state.patternSeeds, state.maxFloat);
  if (!hit) return listing;
  return { ...listing, patternTag: hit.tag, paintSeed: hit.seed, floatValue: hit.floatValue };
}

function kindOf(listing: Listing, state: RuntimeState) {
  if (listing.stickerWhy) return "sticker" as const;
  if (listing.patternTag) return "pattern" as const;
  return classify(listing, opts(state)) ?? (isHot(listing, state.heatMin) ? "rise" : null);
}

function patternRank(a: Alert) {
  const t = `${a.listing.patternTag ?? ""}`.toLowerCase();
  if (/0\.00|0\.99|nines|max fv|fade |ch seed|gem seed/.test(t)) return 3;
  return 1;
}

function patternKey(listing: Listing) {
  return [listingKey(listing), listing.paintSeed ?? "", listing.floatValue ?? "", listing.patternTag ?? "", listing.stickerWhy ?? ""].join("|");
}

function books(listings: Listing[]) {
  const book = stickerBook(listings);
  const naked = new Map<string, number>();
  for (const row of listings) {
    if (row.source !== "skinport" || row.minPrice == null) continue;
    if (row.marketHashName.toLowerCase().startsWith("sticker |")) continue;
    const prev = naked.get(row.marketHashName);
    if (prev == null || row.minPrice < prev) naked.set(row.marketHashName, row.minPrice);
  }
  return { book, naked };
}

export function scanListings(listings: Listing[], state: RuntimeState): Alert[] {
  const now = new Date().toISOString();
  const out: Alert[] = [];
  const { book, naked } = books(listings);

  for (const raw of listings) {
    if (!matchesWatch(raw.marketHashName, state.watch)) continue;
    const listing = stamp(raw, state, book, naked);
    const kind = kindOf(listing, state);
    if (!kind) {
      state.lastMin[listingKey(listing)] = listing.minPrice;
      continue;
    }

    if (kind === "rise") {
      const prev = state.lastHeat[listingKey(listing)] ?? 0;
      state.lastHeat[listingKey(listing)] = listing.heatScore ?? 0;
      if (prev < state.heatMin) out.push(toAlert(listing, "rise", now));
      state.lastMin[listingKey(listing)] = listing.minPrice;
      continue;
    }

    if (kind === "pattern" || kind === "sticker") {
      const key = patternKey(listing);
      const mark = String(listing.minPrice ?? "");
      const prev = state.lastPattern[key];
      state.lastPattern[key] = mark;
      if (prev === undefined || prev !== mark) out.push(toAlert(listing, kind, now));
      state.lastMin[listingKey(listing)] = listing.minPrice;
      continue;
    }

    const prev = state.lastMin[listingKey(listing)];
    state.lastMin[listingKey(listing)] = listing.minPrice;
    if (prev === undefined) continue;
    if (listing.minPrice === prev) continue;
    if (prev != null && listing.minPrice != null && listing.minPrice > prev) continue;
    out.push(toAlert(listing, kind, now));
  }

  return out;
}

export function boardListings(listings: Listing[], state: RuntimeState): Alert[] {
  const now = new Date().toISOString();
  const out: Alert[] = [];
  const { book, naked } = books(listings);
  for (const raw of listings) {
    if (!matchesWatch(raw.marketHashName, state.watch)) continue;
    if (raw.minPrice == null || raw.minPrice <= 0) continue;
    const listing = stamp(raw, state, book, naked);
    const kind = kindOf(listing, state);
    out.push(toAlert(listing, kind ?? "list", now));
  }
  out.sort((a, b) => {
    const ah = a.listing.heatScore ?? 0;
    const bh = b.listing.heatScore ?? 0;
    if (ah >= state.heatMin && bh < state.heatMin) return -1;
    if (bh >= state.heatMin && ah < state.heatMin) return 1;
    if (bh !== ah) return bh - ah;
    return (b.discountPct ?? 0) - (a.discountPct ?? 0);
  });
  const crafts = out.filter((a) => a.kind === "sticker").slice(0, 8);
  const gems = out
    .filter((a) => a.kind === "pattern")
    .sort((a, b) => patternRank(b) - patternRank(a) || (b.discountPct ?? 0) - (a.discountPct ?? 0))
    .slice(0, 16);
  const rest = out.filter((a) => a.kind !== "pattern" && a.kind !== "sticker");
  const catalog = rest.filter((a) => a.kind === "list");
  const deals = rest.filter((a) => a.kind !== "list");
  catalog.sort((a, b) => (b.listing.minPrice ?? 0) - (a.listing.minPrice ?? 0));
  return [...crafts, ...gems, ...deals, ...catalog].slice(0, 480);
}
