import type { Listing } from "../../entities/listing.js";
import { matchesWatch } from "../../entities/listing.js";
import { config } from "../../shared/config.js";
import { loadCatalog, hydrateCatalog, saveCatalog, catalogAge } from "../../shared/catalog.js";
import { fetchSkinport } from "./skinport.js";
import { attachHeat } from "./heat.js";
import { mergeMarkets } from "./markets.js";
import { attachNets } from "./fees.js";

export async function prepareTape(watch: string[]): Promise<Listing[]> {
  let listings = await hydrateCatalog();
  const stale = !listings.length || catalogAge() > config.catalogTtlMs;
  if (stale) {
    try {
      listings = await fetchSkinport(config.currency);
      await saveCatalog(listings);
    } catch (err) {
      console.error(err);
      if (!listings.length) listings = loadCatalog();
    }
  }
  if (!listings.length) return [];
  listings = await mergeMarkets(listings, watch);
  attachNets(listings);
  const watched = listings.filter((row) => matchesWatch(row.marketHashName, watch));
  await attachHeat(watched, config.currency);
  return listings;
}
