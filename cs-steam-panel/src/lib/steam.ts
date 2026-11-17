import type { InventoryItem } from "./types";
import { gates, pacedFetch, sleepJitter } from "./pace";

type Desc = {
  classid?: string;
  name?: string;
  type?: string;
  icon_url?: string;
  tradable?: number;
  tags?: { category?: string; localized_tag_name?: string }[];
};

export async function fetchSummaries(steamIds: string[]) {
  const key = process.env.STEAM_API_KEY || "";
  const ids = steamIds.filter(Boolean).join(",");
  if (!key || !ids) return [] as { steamid: string; personaname: string; avatarfull: string; gameextrainfo?: string }[];
  const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(key)}&steamids=${encodeURIComponent(ids)}`;
  try {
    const r = await pacedFetch(gates.summaries, url, { cache: "no-store" });
    if (!r.ok) return [];
    const j = (await r.json()) as {
      response?: { players?: { steamid: string; personaname: string; avatarfull: string; gameextrainfo?: string }[] };
    };
    return j.response?.players || [];
  } catch {
    return [];
  }
}

export async function fetchInventory(steamId: string): Promise<InventoryItem[]> {
  if (!steamId) return [];
  const url = `https://steamcommunity.com/inventory/${encodeURIComponent(steamId)}/730/2?l=english&count=2000`;
  try {
    const r = await pacedFetch(gates.inventory, url, {
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (!r.ok) return [];
    await sleepJitter(200, 900);
    const j = (await r.json()) as {
      assets?: { assetid: string; classid: string }[];
      descriptions?: Desc[];
    };
    const desc = new Map<string, Desc>();
    for (const d of j.descriptions || []) {
      if (d.classid) desc.set(d.classid, d);
    }
    return (j.assets || []).map((a) => {
      const d = desc.get(a.classid) || {};
      const rarity =
        d.tags?.find((t) => t.category === "Rarity")?.localized_tag_name || "";
      return {
        assetId: a.assetid,
        classId: a.classid,
        name: d.name || a.classid,
        type: d.type || "",
        icon: d.icon_url
          ? `https://community.akamai.steamstatic.com/economy/image/${d.icon_url}`
          : "",
        rarity,
        tradable: d.tradable === 1
      };
    });
  } catch {
    return [];
  }
}

export async function steamPing(): Promise<number | null> {
  const t0 = Date.now();
  try {
    const r = await pacedFetch(
      gates.ping,
      "https://api.steampowered.com/ISteamWebAPIUtil/GetServerInfo/v1/",
      { cache: "no-store" }
    );
    if (!r.ok) return null;
    return Date.now() - t0;
  } catch {
    return null;
  }
}
