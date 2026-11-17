import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";
import { readJson, writeJson } from "./persist.js";
import { loadChats } from "./chats.js";
import { hydrateFilters } from "./filters.js";
import type { Alert } from "../entities/listing.js";
import { normalizeWatch } from "../entities/listing.js";
import type { JournalRow } from "../entities/journal.js";

export type RuntimeState = {
  enabled: boolean;
  spreadPct: number;
  extremePct: number;
  snipePct: number;
  snipeMaxQty: number;
  floor: number;
  watch: string[];
  patternNames: string[];
  patternSeeds: number[];
  maxFloat: number;
  heatMin: number;
  chatIds: string[];
  lastMin: Record<string, number | null>;
  lastPattern: Record<string, string>;
  lastHeat: Record<string, number>;
  alerts: Alert[];
  board: Alert[];
  journal: JournalRow[];
  tickedAt?: number;
};

const defaults = (): RuntimeState => ({
  enabled: true,
  spreadPct: config.spreadPct,
  extremePct: config.extremePct,
  snipePct: config.snipePct,
  snipeMaxQty: config.snipeMaxQty,
  floor: config.floor,
  watch: normalizeWatch(config.watch),
  patternNames: [...config.patternNames],
  patternSeeds: [...config.patternSeeds],
  maxFloat: config.maxFloat,
  heatMin: config.heatMin,
  chatIds: [],
  lastMin: {},
  lastPattern: {},
  lastHeat: {},
  alerts: [],
  board: [],
  journal: [],
  tickedAt: 0,
});

function file() {
  mkdirSync(config.dataDir, { recursive: true });
  return join(config.dataDir, "state.json");
}

export function loadState(): RuntimeState {
  const path = file();
  if (!existsSync(path)) return defaults();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<RuntimeState>;
    return {
      ...defaults(),
      ...raw,
      chatIds: raw.chatIds ?? [],
      lastMin: raw.lastMin ?? {},
      lastPattern: raw.lastPattern ?? {},
      lastHeat: raw.lastHeat ?? {},
      patternNames: raw.patternNames ?? defaults().patternNames,
      patternSeeds: raw.patternSeeds ?? defaults().patternSeeds,
      alerts: raw.alerts ?? [],
      board: raw.board ?? [],
      journal: raw.journal ?? [],
      watch: normalizeWatch(raw.watch ?? defaults().watch),
    };
  } catch {
    return defaults();
  }
}

export function saveState(state: RuntimeState) {
  writeFileSync(file(), JSON.stringify(state));
}

export async function hydrateState(): Promise<RuntimeState> {
  const local = loadState();
  if (local.board?.length) return local;
  const remote = await readJson<Partial<RuntimeState>>("state.json");
  if (!remote) return local;
  const merged: RuntimeState = {
    ...local,
    ...remote,
    chatIds: remote.chatIds ?? local.chatIds,
    lastMin: remote.lastMin ?? local.lastMin,
    lastPattern: remote.lastPattern ?? local.lastPattern,
    lastHeat: remote.lastHeat ?? local.lastHeat,
    alerts: remote.alerts ?? local.alerts,
    board: remote.board ?? local.board,
    journal: remote.journal ?? local.journal,
    watch: normalizeWatch(remote.watch ?? local.watch),
    tickedAt: remote.tickedAt ?? local.tickedAt,
  };
  saveState(merged);
  return merged;
}

export async function persistState(state: RuntimeState) {
  saveState(state);
  await writeJson("state.json", state);
}

export function publicState(state: RuntimeState) {
  return {
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
    alerts: state.alerts.slice(-80).reverse(),
    board: state.board ?? [],
    journal: state.journal,
  };
}

export function seedChats(state: RuntimeState) {
  const extra = (process.env.CHAT_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const id of extra) {
    if (!state.chatIds.includes(id)) state.chatIds.push(id);
  }
}

export async function hydrateChats(state: RuntimeState) {
  seedChats(state);
  for (const id of await loadChats()) {
    if (!state.chatIds.includes(id)) state.chatIds.push(id);
  }
  await hydrateFilters(state);
}
