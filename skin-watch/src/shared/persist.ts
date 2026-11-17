import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";

function localPath(name: string) {
  mkdirSync(config.dataDir, { recursive: true });
  return join(config.dataDir, name);
}

function blobName(name: string) {
  return `skin-desk-${name}`;
}

export async function readJson<T>(name: string): Promise<T | null> {
  const path = localPath(name);
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as T;
    } catch {
      /* fall through */
    }
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const { list } = await import("@vercel/blob");
    const { blobs } = await list({ prefix: blobName(name) });
    const url = blobs[0]?.url;
    if (!url) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as T;
    writeFileSync(path, JSON.stringify(data));
    return data;
  } catch (err) {
    console.error(err);
    return null;
  }
}

export async function writeJson(name: string, data: unknown) {
  const raw = JSON.stringify(data);
  writeFileSync(localPath(name), raw);
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    const { put } = await import("@vercel/blob");
    await put(blobName(name), raw, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  } catch (err) {
    console.error(err);
  }
}
