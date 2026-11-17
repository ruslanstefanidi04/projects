import { config } from "../../shared/config.js";
import { exitMark, sellMark, type Listing } from "../../entities/listing.js";

export type NetPath = {
  buy: string;
  sell: string;
  profit: number;
  profitPct: number;
};

export function sellerFee(source: string) {
  const s = source.toLowerCase();
  if (s === "steam") return config.feeSteam;
  if (s === "skinport") return config.feeSkinport;
  if (s === "csfloat") return config.feeCsfloat;
  if (s === "dmarket") return config.feeDmarket;
  if (s === "waxpeer") return config.feeWaxpeer;
  if (s === "aim") return config.feeAim;
  if (s === "lis") return config.feeLis;
  if (s === "csgotm") return config.feeCsgotm;
  if (s === "skins") return config.feeSkins;
  if (s === "skinplace") return config.feeSkinplace;
  if (s === "white") return config.feeWhite;
  return 0;
}

export function feeNote(source: string) {
  const pct = Math.round(sellerFee(source) * 1000) / 10;
  if (source.toLowerCase() === "steam") return `steam ${pct}% only on scm`;
  if (pct <= 0) return `${source} p2p 0% (no steam fee)`;
  return `${source} ${pct}%`;
}

function sellNet(gross: number, source: string) {
  return gross * (1 - sellerFee(source));
}

function path(buy: string, sell: string, buyPrice: number, sellGross: number): NetPath | null {
  if (!(buyPrice > 0) || !(sellGross > 0)) return null;
  const net = sellNet(sellGross, sell) - buyPrice;
  return {
    buy,
    sell,
    profit: Math.round(net * 100) / 100,
    profitPct: Math.round((net / buyPrice) * 1000) / 10,
  };
}

function fat(n: number) {
  const v = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100;
  return `$${v}`;
}

export function attachNet(listing: Listing): Listing {
  const buy = listing.minPrice;
  const mark = sellMark(listing);
  if (buy == null || !mark) {
    listing.netSame = null;
    listing.netSamePct = null;
    listing.sellAt = null;
    listing.holdWhy = holdWhy(listing);
    return listing;
  }
  const buyVenue = listing.source;
  const sellVenue = buyVenue === "skinport" || buyVenue === "steam" ? buyVenue : "skinport";
  const exit = sellVenue === "skinport" && buyVenue !== "skinport" ? exitMark(listing) : mark;
  if (sellVenue === "skinport" && buyVenue !== "skinport" && !exit) {
    const ask = listing.sellAsk ?? mark.price;
    listing.netSame = null;
    listing.netSamePct = null;
    listing.netBest = null;
    listing.netBestPct = null;
    listing.netVia = "thin";
    listing.netFeeNote = `${listing.sellQty ?? 0} lot ask ignored`;
    listing.sellAt = null;
    listing.sellAsk = listing.sellAsk ?? ask;
    listing.sellVenue = sellVenue;
    listing.routeWhy = `buy ${buyVenue} ${fat(buy)} · skinport ask ${fat(ask)} is one listing, not the median`;
    listing.holdWhy = holdWhy(listing);
    return listing;
  }
  const used = exit ?? mark;
  const deal = path(buyVenue, sellVenue, buy, used.price);
  listing.netSame = deal?.profit ?? null;
  listing.netSamePct = deal?.profitPct ?? null;
  listing.netVia = used.via;
  listing.netBest = deal?.profit ?? null;
  listing.netBestPct = deal?.profitPct ?? null;
  listing.netBestVia = deal ? `${deal.buy}>${deal.sell}` : undefined;
  listing.netFeeNote = feeNote(sellVenue);
  listing.sellAt = used.price;
  listing.sellVenue = sellVenue;
  if (sellVenue === buyVenue) listing.sellUrl = listing.url;
  listing.routeWhy = `buy ${buyVenue} ${fat(buy)} → sell ${sellVenue} ${used.via} ${fat(used.price)}`;
  listing.holdWhy = holdWhy(listing);
  return listing;
}

function holdWhy(listing: Listing) {
  const src = listing.source.toLowerCase();
  if (src === "steam") return "steam path: 15% on scm, wallet stays on steam. not a p2p exit.";
  if (src === "skinport") {
    if (listing.onHold) return "this card is the locked ask. site default is unlocked. withdraw to steam ~7d hold, not a ban.";
    if (listing.minHold != null) return `unlocked ask used for net. locked dump ${listing.minHold}. relist on skinport; withdraw ~7d.`;
    return "relist on skinport without withdrawing. withdraw to steam = ~7d hold, not a ban.";
  }
  if (
    src === "csfloat" ||
    src === "dmarket" ||
    src === "aim" ||
    src === "waxpeer" ||
    src === "lis" ||
    src === "csgotm" ||
    src === "skins" ||
    src === "skinplace" ||
    src === "white"
  ) {
    return "p2p: steam trade hold ~7d after you receive it. fee is this site, not steam 15%.";
  }
  return "p2p hold ~7d after steam trade. no steam market fee unless you list on scm.";
}

export function attachNets(listings: Listing[]) {
  for (const row of listings) attachNet(row);
  return listings;
}
