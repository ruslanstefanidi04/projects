import { Bot, InlineKeyboard } from "grammy";
import { config } from "../shared/config.js";
import { saveState, type RuntimeState } from "../shared/store.js";
import { rememberChat } from "../shared/chats.js";
import { formatAlert } from "../features/watch/format.js";
import { loadOutlook } from "../features/outlook/store.js";
import type { Alert } from "../entities/listing.js";

const tgKinds = new Set(["snipe", "extreme", "floor", "pattern", "rise", "sticker"]);

const helpText = [
  "alive. this is notify + buy link only. no auto-buy.",
  "",
  "/start  link this chat for alerts",
  "/ping   am i here",
  "/id     your chat id (put in CHAT_IDS if alerts vanish)",
  "/outlook last weekly pass",
  "",
  "alerts: snipe / pattern / sticker / rise. desk tab must tick on vercel.",
  "outlook: monday 08:00 utc if OPENROUTER_API_KEY is set.",
].join("\n");

export function createBot(getState: () => RuntimeState) {
  if (!config.telegramToken) return null;
  const bot = new Bot(config.telegramToken);

  bot.command("start", async (ctx) => {
    const id = String(ctx.chat.id);
    const state = getState();
    state.chatIds = await rememberChat(id, state.chatIds);
    saveState(state);
    await ctx.reply(`linked chat ${id}.\n\n${helpText}`);
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(helpText);
  });

  bot.command("ping", async (ctx) => {
    await ctx.reply(`pong  chat ${ctx.chat.id}  ${new Date().toISOString()}`);
  });

  bot.command("id", async (ctx) => {
    await ctx.reply(String(ctx.chat.id));
  });

  bot.command("outlook", async (ctx) => {
    const doc = await loadOutlook();
    if (!doc) {
      await ctx.reply("no outlook yet. monday cron or run locally.");
      return;
    }
    const grow = doc.picks.filter((p) => p.stance === "grow").slice(0, 8);
    const lines = [
      `outlook ${doc.at.slice(0, 10)}`,
      ...grow.map((p) => `${p.confidence} ${p.name}`),
      "full list: prgt-vault.vercel.app/outlook",
    ];
    await ctx.reply(lines.join("\n"));
  });

  return bot;
}

export async function ensureBotMenu(bot: Bot) {
  await bot.api
    .setMyCommands([
      { command: "start", description: "link this chat" },
      { command: "help", description: "how this bot works" },
      { command: "ping", description: "check if alive" },
      { command: "id", description: "show chat id" },
      { command: "outlook", description: "last weekly pass" },
    ])
    .catch(() => undefined);
}

export async function pushAlerts(bot: Bot | null, alerts: Alert[], state: RuntimeState) {
  if (!alerts.length) return;
  state.alerts = [...state.alerts, ...alerts].slice(-200);
  saveState(state);
  if (!bot || !state.chatIds.length) return;

  const urgent = alerts.filter((a) => tgKinds.has(a.kind));
  for (const alert of urgent) {
    const kb = new InlineKeyboard().url(alert.listing.source, alert.listing.url);
    const seen = new Set([alert.listing.url]);
    for (const q of alert.listing.quotes ?? []) {
      if (seen.has(q.url)) continue;
      seen.add(q.url);
      kb.url(q.source, q.url);
    }
    const text = formatAlert(alert, config.currency);
    for (const chatId of state.chatIds) {
      await bot.api.sendMessage(chatId, text, { reply_markup: kb }).catch(() => undefined);
    }
  }
}
