import { config } from "../shared/config.js";
import { loadState, saveState, hydrateChats } from "../shared/store.js";
import { hydrateListing } from "../shared/catalog.js";
import { prepareTape } from "../features/watch/tape.js";
import { boardListings, scanListings } from "../features/watch/scan.js";
import { createBot, ensureBotMenu, pushAlerts } from "./telegram.js";
import { emitAlerts, emitTick } from "./bus.js";
import { startDesk } from "./server.js";
import { maybeWeeklyOutlook } from "../features/outlook/run.js";
import type { Alert } from "../entities/listing.js";

const state = loadState();
const bot = createBot(() => state);
let cached: Alert["listing"][] = [];
let board: Alert[] = [];
let lastTick = "";

async function tick() {
  if (!state.enabled) {
    emitTick({ ok: true, paused: true, at: new Date().toISOString(), board });
    return;
  }
  let listings = cached;
  try {
    listings = await prepareTape(state.watch);
    cached = listings;
  } catch (err) {
    console.error(err);
    if (!listings.length) return;
  }
  const alerts = scanListings(listings, state);
  board = boardListings(listings, state);
  lastTick = new Date().toISOString();
  saveState(state);
  if (alerts.length) {
    emitAlerts(alerts);
    await pushAlerts(bot, alerts, state);
    console.log(`alerts ${alerts.length}`);
  }
  emitTick({ ok: true, paused: false, at: lastTick, count: listings.length, board });
}

async function main() {
  startDesk(() => state, () => {
    if (board.length) return board;
    return state.alerts.slice(-80).reverse().map((a) => ({
      ...a,
      listing: hydrateListing(a.listing),
    }));
  });
  await hydrateChats(state);
  if (bot) {
    await ensureBotMenu(bot);
    bot.start({ onStart: (info) => console.log(`telegram @${info.username}`) });
  } else {
    console.log("no TELEGRAM_BOT_TOKEN");
  }
  await tick().catch((err) => console.error(err));
  maybeWeeklyOutlook();
  setInterval(() => {
    maybeWeeklyOutlook();
  }, 6 * 60 * 60 * 1000);
  setInterval(() => {
    tick().catch((err) => console.error(err));
  }, config.pollSec * 1000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
