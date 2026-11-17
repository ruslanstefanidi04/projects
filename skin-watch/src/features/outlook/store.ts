import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../../shared/config.js";
import type { OutlookReport } from "./types.js";

function localPath() {
  mkdirSync(config.dataDir, { recursive: true });
  return join(config.dataDir, "outlook.json");
}

export async function saveOutlook(doc: OutlookReport) {
  writeFileSync(localPath(), JSON.stringify(doc));
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) return;
  try {
    const { put } = await import("@vercel/blob");
    await put("skin-desk-outlook.json", JSON.stringify(doc), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  } catch (err) {
    console.error(err);
  }
}

export async function loadOutlook(): Promise<OutlookReport | null> {
  if (existsSync(localPath())) {
    try {
      return JSON.parse(readFileSync(localPath(), "utf8")) as OutlookReport;
    } catch {
      // fall through to blob
    }
  }
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) return null;
  try {
    const { list } = await import("@vercel/blob");
    const { blobs } = await list({ prefix: "skin-desk-outlook.json" });
    const url = blobs[0]?.url;
    if (!url) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as OutlookReport;
  } catch {
    return null;
  }
}

export function isFresh(doc: OutlookReport | null, days = 6.5) {
  if (!doc?.at) return false;
  const age = Date.now() - new Date(doc.at).getTime();
  return age < days * 24 * 60 * 60 * 1000;
}
