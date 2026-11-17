import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";
import { normalizeWatch } from "../entities/listing.js";
import type { RuntimeState } from "./store.js";

const BLOB = "skin-desk-filters.json";

export type FilterSnap = {
  watch: string[];
  patternNames: string[];
  patternSeeds: number[];
  spreadPct: number;
  extremePct: number;
  snipePct: number;
  snipeMaxQty: number;
  floor: number;
  maxFloat: number;
  heatMin: number;
};

function localPath() {
  mkdirSync(config.dataDir, { recursive: true });
  return join(config.dataDir, "filters.json");
}

export function snapFilters(state: RuntimeState): FilterSnap {
  return {
    watch: normalizeWatch(state.watch),
    patternNames: [...state.patternNames],
    patternSeeds: [...state.patternSeeds],
    spreadPct: state.spreadPct,
    extremePct: state.extremePct,
    snipePct: state.snipePct,
    snipeMaxQty: state.snipeMaxQty,
    floor: state.floor,
    maxFloat: state.maxFloat,
    heatMin: state.heatMin,
  };
}

export function applyFilters(state: RuntimeState, snap: FilterSnap) {
  state.watch = normalizeWatch(snap.watch ?? []);
  if (snap.patternNames) state.patternNames = snap.patternNames;
  if (snap.patternSeeds) state.patternSeeds = snap.patternSeeds;
  for (const key of ["spreadPct", "extremePct", "snipePct", "snipeMaxQty", "floor", "maxFloat", "heatMin"] as const) {
    const n = Number(snap[key]);
    if (Number.isFinite(n) && n >= 0) state[key] = n;
  }
}

export async function loadFilters(): Promise<FilterSnap | null> {
  if (existsSync(localPath())) {
    try {
      return JSON.parse(readFileSync(localPath(), "utf8")) as FilterSnap;
    } catch {
      // fall through
    }
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const { list } = await import("@vercel/blob");
    const { blobs } = await list({ prefix: BLOB });
    const url = blobs[0]?.url;
    if (!url) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as FilterSnap;
  } catch {
    return null;
  }
}

export async function saveFilters(state: RuntimeState) {
  const snap = snapFilters(state);
  writeFileSync(localPath(), JSON.stringify(snap));
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    const { put } = await import("@vercel/blob");
    await put(BLOB, JSON.stringify(snap), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  } catch (err) {
    console.error(err);
  }
}

export async function hydrateFilters(state: RuntimeState) {
  const snap = await loadFilters();
  if (snap && Array.isArray(snap.watch)) applyFilters(state, snap);
}
