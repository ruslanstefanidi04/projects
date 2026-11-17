export type Quote = {
  source: string;
  price: number;
  url: string;
  qty?: number;
  version?: string;
};

export type Listing = {
  marketHashName: string;
  minPrice: number | null;
  suggestedPrice: number | null;
  quantity: number;
  url: string;
  image: string;
  source: string;
  paintSeed?: number;
  floatValue?: number;
  fadePct?: number;
  patternTag?: string;
  version?: string;
  meanPrice?: number | null;
  medianPrice?: number | null;
  maxPrice?: number | null;
  heatScore?: number;
  heatWhy?: string;
  quotes?: Quote[];
  stickers?: { name: string; usd: number; wear?: number }[];
  stickerValue?: number;
  stickerWhy?: string;
  netSame?: number | null;
  netSamePct?: number | null;
  netBest?: number | null;
  netBestPct?: number | null;
  netBestVia?: string;
  netVia?: string;
  netFeeNote?: string;
  sellAt?: number | null;
  minLive?: number | null;
  minHold?: number | null;
  onHold?: boolean;
  routeWhy?: string;
  holdWhy?: string;
  sellVenue?: string;
  sellUrl?: string;
  sellAsk?: number | null;
  sellQty?: number | null;
};

export type AlertKind = "extreme" | "snipe" | "spread" | "floor" | "pattern" | "rise" | "sticker" | "list";

export type ClassifyOpts = {
  spreadPct: number;
  extremePct: number;
  snipePct: number;
  snipeMaxQty: number;
  floor: number;
};

export type Alert = {
  kind: AlertKind;
  listing: Listing;
  discountPct: number | null;
  at: string;
};

export function listingKey(listing: Pick<Listing, "marketHashName" | "version" | "source" | "stickers">) {
  const v = listing.version?.trim() ?? "";
  const stick = (listing.stickers ?? []).map((s) => s.name).sort().join(",");
  return `${listing.source}\t${listing.marketHashName}\t${v}\t${stick}`;
}

export function sellMark(listing: Listing): { price: number; via: "median" | "mean" | "suggested" } | null {
  const sug = listing.suggestedPrice;
  const med = listing.medianPrice;
  const mean = listing.meanPrice;
  if (med != null && med > 0 && sug != null && sug > 0) {
    if (sug > med * 1.08) return { price: med, via: "median" };
    return { price: Math.min(sug, med), via: sug <= med ? "suggested" : "median" };
  }
  if (med != null && med > 0) return { price: med, via: "median" };
  if (mean != null && mean > 0) return { price: mean, via: "mean" };
  if (sug != null && sug > 0) return { price: sug, via: "suggested" };
  return null;
}

function belowAsk(price: number | null | undefined, ask: number | null) {
  if (price == null || !(price > 0)) return false;
  if (ask == null || !(ask > 0)) return true;
  return price < ask * 0.95;
}

// skinport median/suggested often copy the current ask when the book is 1-2 lots.
// that is a seller, not a fill. only treat marks below the ask as a sale hint.
export function honestSkinportSale(listing: Listing): { price: number; via: "median" | "suggested" | "mean" } | null {
  const ask = listing.sellAsk ?? null;
  const sug = listing.suggestedPrice;
  const med = listing.medianPrice;
  const mean = listing.meanPrice;
  if (belowAsk(sug, ask) && belowAsk(med, ask) && sug != null && med != null) {
    if (sug > med * 1.08) return { price: med, via: "median" };
    return { price: Math.min(sug, med), via: sug <= med ? "suggested" : "median" };
  }
  if (belowAsk(med, ask) && med != null) return { price: med, via: "median" };
  if (belowAsk(mean, ask) && mean != null) return { price: mean, via: "mean" };
  if (belowAsk(sug, ask) && sug != null) return { price: sug, via: "suggested" };
  return null;
}

export function exitMark(listing: Listing): { price: number; via: string } | null {
  const src = listing.source.toLowerCase();
  if (src === "skinport" || src === "steam") return sellMark(listing);
  return honestSkinportSale(listing);
}

export function discountPct(listing: Listing): number | null {
  const { minPrice } = listing;
  const mark = exitMark(listing);
  if (minPrice == null || !mark || mark.price <= 0) return null;
  return ((mark.price - minPrice) / mark.price) * 100;
}

export function classify(listing: Listing, opts: ClassifyOpts): AlertKind | null {
  const { minPrice } = listing;
  if (minPrice == null || minPrice <= 0) return null;
  if (opts.floor > 0 && minPrice <= opts.floor) return "floor";
  const d = discountPct(listing);
  if (d == null) return null;
  if (d >= opts.extremePct) return "extreme";
  if (d >= opts.snipePct) return "snipe";
  if (d >= opts.spreadPct) return "spread";
  return null;
}

const CLASS_MATCH: Record<string, (n: string) => boolean> = {
  knives: (n) =>
    (n.includes("★") && !n.includes("gloves") && !n.includes("wraps")) ||
    /\b(knife|karambit|bayonet|shadow daggers|ursus|kukri)\b/.test(n),
  gloves: (n) => n.includes("gloves") || n.includes("wraps"),
  rifles: (n) => /ak-47|m4a1|m4a4|famas|galil|aug|sg 553/.test(n),
  snipers: (n) => /awp|ssg 08|g3sg1|scar-20/.test(n),
  pistols: (n) => /glock|usp-s|p2000|p250|desert eagle|five-seve|tec-9|cz75|r8 revolver|dual berettas/.test(n),
  smgs: (n) => /mac-10|mp9|mp7|mp5|ump-45|p90|pp-bizon/.test(n),
  lmgs: (n) => /negev|m249/.test(n),
  cases: (n) => /\bcase\b/.test(n) && !n.includes("|"),
  stickers: (n) => n.startsWith("sticker |"),
};

export function normalizeWatch(watch: string[]) {
  const out = new Set<string>();
  for (const raw of watch) {
    const w = raw.trim();
    if (!w || /^[?]+$/.test(w) || w.includes("\uFFFD")) continue;
    const l = w.toLowerCase();
    if (l === "★" || l === "*" || l === "knife" || l === "karambit" || l === "bayonet") {
      out.add("knives");
      continue;
    }
    if (l === "gloves" || l === "wraps") {
      out.add("gloves");
      continue;
    }
    if (CLASS_MATCH[l] || l.startsWith("finish:")) {
      out.add(l);
      continue;
    }
    out.add(w);
  }
  return [...out];
}

export function matchesWatch(name: string, watch: string[]) {
  const tokens = normalizeWatch(watch);
  if (!tokens.length) return true;
  const n = name.toLowerCase();
  const classes = tokens.filter((w) => CLASS_MATCH[w.toLowerCase()]);
  const finishes = tokens
    .filter((w) => w.toLowerCase().startsWith("finish:"))
    .map((w) => w.slice("finish:".length).toLowerCase());
  const extra = tokens.filter((w) => !CLASS_MATCH[w.toLowerCase()] && !w.toLowerCase().startsWith("finish:"));

  const classHit = !classes.length || classes.some((c) => CLASS_MATCH[c.toLowerCase()](n));
  const finishHit = !finishes.length || finishes.some((f) => n.includes(f));
  const extraHit = !extra.length || extra.some((w) => n.includes(w.toLowerCase()));
  if (classes.length || finishes.length) return classHit && finishHit && (!extra.length || extraHit);
  return extraHit;
}

export function toAlert(listing: Listing, kind: AlertKind, at: string): Alert {
  return { kind, listing, discountPct: discountPct(listing), at };
}
