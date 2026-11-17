import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../shared/config.js";

function fileFor(name: string) {
  const dir = join(config.dataDir, "img");
  mkdirSync(dir, { recursive: true });
  const id = createHash("sha1").update(name).digest("hex");
  return join(dir, `${id}.png`);
}

export function imagePath(name: string, version?: string | null) {
  const v = version?.trim() ? `&v=${encodeURIComponent(version.trim())}` : "";
  return `/api/img?n=${encodeURIComponent(name)}${v}`;
}

export async function loadSkinPng(name: string): Promise<Buffer | null> {
  const path = fileFor(name);
  if (existsSync(path)) return readFileSync(path);
  const src = `https://api.steamapis.com/image/item/730/${encodeURIComponent(name)}`;
  const res = await fetch(src, {
    headers: { accept: "image/png,image/*", "user-agent": "SkinDesk/0.2" },
  });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 80) return null;
  writeFileSync(path, buf);
  return buf;
}
