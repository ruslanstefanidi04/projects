import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";
import type { Listing } from "../entities/listing.js";
import { imagePath } from "../lib/skin-image.js";
import { readJson, writeJson } from "./persist.js";

type CatalogSnap = { at: number; rows: Listing[] };

const path = () => join(config.dataDir, "catalog.json");

export function hydrateListing(listing: Listing): Listing {
  return {
    ...listing,
    image: imagePath(listing.marketHashName, listing.version),
  };
}

function mapRows(rows: Listing[]) {
  return rows.map(hydrateListing);
}

export function loadCatalog(): Listing[] {
  if (!existsSync(path())) return [];
  try {
    const raw = JSON.parse(readFileSync(path(), "utf8")) as CatalogSnap | Listing[];
    const rows = Array.isArray(raw) ? raw : raw.rows ?? [];
    return mapRows(rows);
  } catch {
    return [];
  }
}

export function catalogAge(): number {
  if (!existsSync(path())) return Number.POSITIVE_INFINITY;
  try {
    const raw = JSON.parse(readFileSync(path(), "utf8")) as CatalogSnap | Listing[];
    if (Array.isArray(raw)) return Number.POSITIVE_INFINITY;
    if (!raw.at) return Number.POSITIVE_INFINITY;
    return Date.now() - raw.at;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export async function hydrateCatalog(): Promise<Listing[]> {
  const local = loadCatalog();
  if (local.length && catalogAge() < config.catalogTtlMs) return local;
  if (local.length) return local;
  const remote = await readJson<CatalogSnap>("catalog.json");
  if (!remote?.rows?.length) return local;
  writeFileSync(path(), JSON.stringify(remote));
  return mapRows(remote.rows);
}

export async function saveCatalog(rows: Listing[]) {
  const snap: CatalogSnap = { at: Date.now(), rows };
  await writeJson("catalog.json", snap);
}
