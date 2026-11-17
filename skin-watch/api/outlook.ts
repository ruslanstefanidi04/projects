import type { VercelRequest, VercelResponse } from "@vercel/node";
import { config } from "../src/shared/config.js";
import { loadOutlook } from "../src/features/outlook/store.js";
import { runOutlook } from "../src/features/outlook/run.js";

export const maxDuration = 60;

function canRun(req: VercelRequest) {
  if (req.headers["x-vercel-cron"]) return true;
  if (!process.env.VERCEL) return true;
  if (!config.cronSecret) return false;
  return String(req.headers.authorization ?? "") === `Bearer ${config.cronSecret}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "no-store");
  if (req.method === "GET") {
    const doc = await loadOutlook();
    res.status(200).json({
      ok: true,
      configured: Boolean(config.openrouterKey),
      model: config.openrouterModel,
      report: doc,
    });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }
  if (!canRun(req)) {
    res.status(401).json({ error: "weekly cron only" });
    return;
  }
  try {
    const report = await runOutlook(true);
    res.status(200).json({ ok: true, report });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "outlook failed" });
  }
}
