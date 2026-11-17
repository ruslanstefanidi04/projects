import type { VercelRequest, VercelResponse } from "@vercel/node";
import { config } from "../src/shared/config.js";
import { runTick } from "../src/app/runtime.js";

export const maxDuration = 60;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cron = req.headers["x-vercel-cron"];
  if (cron && config.cronSecret) {
    const auth = String(req.headers.authorization ?? "");
    if (auth !== `Bearer ${config.cronSecret}`) {
      res.status(401).json({ error: "cron" });
      return;
    }
  }
  const raw = req.body;
  const overlay = typeof raw === "string" ? (raw ? JSON.parse(raw) : {}) : raw ?? {};
  const out = await runTick(overlay);
  res.setHeader("cache-control", "no-store");
  res.status(200).json(out);
}
