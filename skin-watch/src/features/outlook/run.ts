import { config } from "../../shared/config.js";
import { loadState, hydrateChats } from "../../shared/store.js";
import { fetchSkinport, fetchSkinportHistory, type HistoryRow } from "../watch/skinport.js";
import { loadCatalog, saveCatalog } from "../../shared/catalog.js";
import { createBot } from "../../app/telegram.js";
import { buildUniverse, marketRegime } from "./universe.js";
import { askOutlook } from "./openrouter.js";
import { isFresh, loadOutlook, saveOutlook } from "./store.js";
import type { OutlookReport } from "./types.js";

export async function runOutlook(force = false): Promise<OutlookReport> {
  const prev = await loadOutlook();
  if (!force && isFresh(prev)) return prev as OutlookReport;

  let listings = loadCatalog();
  try {
    listings = await fetchSkinport(config.currency);
    saveCatalog(listings);
  } catch (err) {
    console.error(err);
    if (!listings.length) throw err instanceof Error ? err : new Error("no catalog");
  }

  let history: HistoryRow[] = [];
  try {
    history = await fetchSkinportHistory(config.currency);
  } catch (err) {
    console.error(err);
  }

  const state = loadState();
  await hydrateChats(state);
  const fed = buildUniverse(listings, history, state.watch);
  if (!fed.length) throw new Error("empty universe");
  const regime = marketRegime(listings, history, fed);
  const ai = await askOutlook(fed, regime);
  const doc: OutlookReport = {
    ...ai,
    at: new Date().toISOString(),
    catalogSize: listings.length,
    fed: fed.length,
  };
  await saveOutlook(doc);
  const bot = createBot(() => state);
  await pushOutlook(bot, state.chatIds, doc);
  return doc;
}

export async function maybeWeeklyOutlook() {
  if (!config.openrouterKey) return;
  try {
    await runOutlook(false);
  } catch (err) {
    console.error(err);
  }
}

async function pushOutlook(
  bot: ReturnType<typeof createBot>,
  chatIds: string[],
  doc: OutlookReport,
) {
  if (!bot || !chatIds.length) return;
  const grow = doc.picks.filter((p) => p.stance === "grow").slice(0, 12);
  const lines = [
    `outlook ${doc.at.slice(0, 10)}  ${doc.model}`,
    doc.regime,
    doc.newsNotes,
    "",
    ...grow.map((p) => `${p.confidence} ${p.name}\n${p.thesis}`),
    "",
    doc.disclaimer,
    "open desk /outlook  you click buy",
  ];
  const text = lines.filter(Boolean).join("\n").slice(0, 3500);
  for (const chatId of chatIds) {
    await bot.api.sendMessage(chatId, text).catch(() => undefined);
  }
}
