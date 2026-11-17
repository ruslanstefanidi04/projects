import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv() {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (process.env[k] == null) process.env[k] = v;
  }
}

loadDotEnv();

function num(key: string, fallback: number) {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "",
  currency: (process.env.CURRENCY ?? "USD").toUpperCase(),
  pollSec: Math.max(30, num("POLL_SEC", 30)),
  spreadPct: num("SPREAD_PCT", 8),
  extremePct: num("EXTREME_PCT", 70),
  snipePct: num("SNIPE_PCT", 40),
  snipeMaxQty: Math.max(1, num("SNIPE_MAX_QTY", 6)),
  floor: num("FLOOR", 0),
  patternPct: num("PATTERN_PCT", 18),
  watch: (process.env.WATCH ?? "knives,gloves")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  patternNames: (process.env.PATTERN_NAMES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  patternSeeds: (process.env.PATTERN_SEEDS ?? "")
    .split(/[,\s]+/)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n >= 0),
  maxFloat: num("MAX_FLOAT", 0),
  heatMin: num("HEAT_MIN", 56),
  webPort: Math.max(1, num("WEB_PORT", 8788)),
  dataDir: process.env.VERCEL ? "/tmp/skin-desk" : resolve(process.cwd(), "data"),
  cronSecret: process.env.CRON_SECRET?.trim() ?? "",
  openrouterKey: process.env.OPENROUTER_API_KEY?.trim() ?? "",
  openrouterModel: process.env.OPENROUTER_MODEL?.trim() || "openai/gpt-4o-mini:online",
  outlookLimit: Math.min(120, Math.max(20, num("OUTLOOK_LIMIT", 80))),
  outlookMinUsd: num("OUTLOOK_MIN_USD", 12),
  outlookMaxUsd: num("OUTLOOK_MAX_USD", 1800),
  steamOn: process.env.STEAM !== "0",
  steamPerTick: Math.min(40, Math.max(5, num("STEAM_PER_TICK", 24))),
  csfloatKey: process.env.CSFLOAT_API_KEY?.trim() ?? "",
  stickerMinUsd: num("STICKER_MIN_USD", 80),
  quotePerTick: Math.min(20, Math.max(2, num("QUOTE_PER_TICK", 8))),
  feeSkinport: Math.min(40, Math.max(0, num("SKINPORT_SELL_FEE", 6))) / 100,
  feeSteam: Math.min(40, Math.max(0, num("STEAM_SELL_FEE", 15))) / 100,
  feeCsfloat: Math.min(40, Math.max(0, num("CSFLOAT_SELL_FEE", 2))) / 100,
  feeDmarket: Math.min(40, Math.max(0, num("DMARKET_SELL_FEE", 5))) / 100,
  feeWaxpeer: Math.min(40, Math.max(0, num("WAXPEER_SELL_FEE", 2))) / 100,
  feeAim: Math.min(40, Math.max(0, num("AIM_SELL_FEE", 0))) / 100,
  feeLis: Math.min(40, Math.max(0, num("LIS_SELL_FEE", 2))) / 100,
  feeCsgotm: Math.min(40, Math.max(0, num("CSGOTM_SELL_FEE", 5))) / 100,
  feeSkins: Math.min(40, Math.max(0, num("SKINS_SELL_FEE", 0))) / 100,
  feeSkinplace: Math.min(40, Math.max(0, num("SKINPLACE_SELL_FEE", 5))) / 100,
  feeWhite: Math.min(40, Math.max(0, num("WHITE_SELL_FEE", 5))) / 100,
  catalogTtlMs: Math.max(60, num("CATALOG_TTL_MIN", 8)) * 60 * 1000,
  dumpTtlMs: Math.max(60, num("DUMP_TTL_MIN", 30)) * 60 * 1000,
  tickSkipMs: Math.max(15, num("TICK_SKIP_SEC", 90)) * 1000,
};
