import type { VercelRequest, VercelResponse } from "@vercel/node";
import { loadState, hydrateChats } from "../src/shared/store.js";
import { createBot, ensureBotMenu } from "../src/app/telegram.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }
  const state = loadState();
  await hydrateChats(state);
  const bot = createBot(() => state);
  if (!bot) {
    res.status(500).json({ error: "no bot" });
    return;
  }
  await bot.init();
  await ensureBotMenu(bot);
  const update = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  await bot.handleUpdate(update);
  res.status(200).json({ ok: true });
}
