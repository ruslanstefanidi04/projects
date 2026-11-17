import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";

const BLOB = "skin-desk-chats.json";

function localPath() {
  mkdirSync(config.dataDir, { recursive: true });
  return join(config.dataDir, "chats.json");
}

function merge(ids: string[]) {
  return [...new Set(ids.map((x) => String(x).trim()).filter(Boolean))];
}

export async function loadChats(): Promise<string[]> {
  const out: string[] = [];
  if (existsSync(localPath())) {
    try {
      const raw = JSON.parse(readFileSync(localPath(), "utf8")) as { chatIds?: string[] };
      out.push(...(raw.chatIds ?? []));
    } catch {
      // ignore broken cache
    }
  }
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const { list } = await import("@vercel/blob");
      const { blobs } = await list({ prefix: BLOB });
      const url = blobs[0]?.url;
      if (url) {
        const res = await fetch(url);
        if (res.ok) {
          const raw = (await res.json()) as { chatIds?: string[] };
          out.push(...(raw.chatIds ?? []));
        }
      }
    } catch (err) {
      console.error(err);
    }
  }
  return merge(out);
}

export async function saveChats(chatIds: string[]) {
  const ids = merge(chatIds);
  writeFileSync(localPath(), JSON.stringify({ chatIds: ids }));
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    const { put } = await import("@vercel/blob");
    await put(BLOB, JSON.stringify({ chatIds: ids }), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  } catch (err) {
    console.error(err);
  }
}

export async function rememberChat(id: string, current: string[]) {
  const ids = merge([...current, id]);
  await saveChats(ids);
  return ids;
}
