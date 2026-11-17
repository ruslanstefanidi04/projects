import { config } from "../shared/config.js";
import { loadState, persistState, seedChats, hydrateChats, hydrateState } from "../shared/store.js";
import { hydrateListing, hydrateCatalog } from "../shared/catalog.js";
import { prepareTape } from "../features/watch/tape.js";
import { boardListings, scanListings } from "../features/watch/scan.js";
import { attachNets } from "../features/watch/fees.js";
import { createBot, pushAlerts } from "./telegram.js";
import { pnl } from "../entities/journal.js";
import type { Listing } from "../entities/listing.js";
import { matchesWatch, normalizeWatch } from "../entities/listing.js";
import { saveFilters } from "../shared/filters.js";
import type { RuntimeState } from "../shared/store.js";

export function snapshot(state: RuntimeState) {
  return {
    currency: config.currency,
    pollSec: config.pollSec,
    enabled: state.enabled,
    spreadPct: state.spreadPct,
    extremePct: state.extremePct,
    snipePct: state.snipePct,
    snipeMaxQty: state.snipeMaxQty,
    floor: state.floor,
    watch: state.watch,
    patternNames: state.patternNames,
    patternSeeds: state.patternSeeds,
    maxFloat: state.maxFloat,
    heatMin: state.heatMin,
    chats: state.chatIds.length,
    markets: [
      "skinport",
      config.steamOn ? "steam" : null,
      "csfloat",
      "dmarket",
      "aim",
      "waxpeer",
      "lis",
      "csgotm",
      "skins",
      "skinplace",
      "white",
    ].filter(Boolean),
    alerts: state.alerts.slice(-80).reverse(),
    journal: state.journal,
    board: (state.board ?? []).map((a) => ({
      ...a,
      listing: hydrateListing(a.listing),
    })),
    tickedAt: state.tickedAt ?? 0,
    pnl: pnl(state.journal),
  };
}

type ConfigPatch = Partial<RuntimeState> & { watchText?: string; patternText?: string; seedText?: string };

function patchConfig(state: RuntimeState, raw: ConfigPatch) {
  if (typeof raw.enabled === "boolean") state.enabled = raw.enabled;
  for (const key of ["spreadPct", "extremePct", "snipePct", "snipeMaxQty", "floor", "maxFloat", "heatMin"] as const) {
    const n = Number(raw[key]);
    if (Number.isFinite(n) && n >= 0) state[key] = n;
  }
  if (typeof raw.watchText === "string") {
    state.watch = normalizeWatch(raw.watchText.split(",").map((s) => s.trim()).filter(Boolean));
  }
  if (Array.isArray(raw.watch)) {
    state.watch = normalizeWatch(raw.watch);
  }
  if (typeof raw.patternText === "string") {
    state.patternNames = raw.patternText.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (typeof raw.seedText === "string") {
    state.patternSeeds = raw.seedText
      .split(/[,\s]+/)
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 1000);
  }
}

export async function runTick(overlay?: ConfigPatch) {
  const state = await hydrateState();
  await hydrateChats(state);
  if (overlay) patchConfig(state, overlay);
  if (!state.enabled) {
    await persistState(state);
    return { ...snapshot(state), paused: true, cached: true };
  }

  const n = state.board?.length ?? 0;
  const fresh = n >= 80 && Date.now() - (state.tickedAt ?? 0) < config.tickSkipMs;
  if (fresh) {
    return { ...snapshot(state), paused: false, cached: true, count: state.board.length };
  }

  let listings: Listing[] = [];
  try {
    listings = await prepareTape(state.watch);
  } catch (err) {
    console.error(err);
  }

  if (listings.length) {
    const alerts = scanListings(listings, state);
    state.board = boardListings(listings, state);
    if (alerts.length) {
      const bot = createBot(() => state);
      await pushAlerts(bot, alerts, state);
    }
  } else {
    state.board = (state.board ?? []).filter((a) => matchesWatch(a.listing.marketHashName, state.watch));
  }
  state.tickedAt = Date.now();
  await persistState(state);
  return { ...snapshot(state), paused: false, cached: false, count: listings.length };
}

export async function mutateConfig(raw: ConfigPatch) {
  const state = await hydrateState();
  seedChats(state);
  patchConfig(state, raw);
  const catalog = await hydrateCatalog();
  if (catalog.length) {
    attachNets(catalog);
    state.board = boardListings(catalog, state);
  } else {
    state.board = (state.board ?? []).filter((a) => matchesWatch(a.listing.marketHashName, state.watch));
  }
  await persistState(state);
  await saveFilters(state);
  return snapshot(state);
}

export function addJournal(side: "buy" | "sell", name: string, price: number) {
  const state = loadState();
  state.journal.push({ side, name, price, at: new Date().toISOString() });
  void persistState(state);
  return snapshot(state);
}
