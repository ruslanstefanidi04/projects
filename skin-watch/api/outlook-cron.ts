import type { VercelRequest, VercelResponse } from "@vercel/node";
import { config } from "../src/shared/config.js";
import { runOutlook } from "../src/features/outlook/run.js";

export const maxDuration = 60;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cron = Boolean(req.headers["x-vercel-cron"]);
  const authOk = config.cronSecret && String(req.headers.authorization ?? "") === `Bearer ${config.cronSecret}`;
  if (process.env.VERCEL && !cron && !authOk) {
    res.status(401).json({ error: "cron" });
    return;
  }
  try {
    const report = await runOutlook(true);
    res.status(200).json({ ok: true, at: report.at, picks: report.picks.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "outlook failed" });
  }
}
