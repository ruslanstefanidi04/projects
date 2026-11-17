import type { Listing } from "../../entities/listing.js";
import { discountPct } from "../../entities/listing.js";
import { config } from "../../shared/config.js";

export type PatternHit = {
  tag: string;
  seed?: number;
  floatValue?: number;
};

const GEM_VERSION = new Set(["sapphire", "ruby", "emerald", "black pearl", "blackpearl"]);

export const GEM_SEEDS: Record<string, number[]> = {
  "ak-47 | case hardened": [661, 670, 151, 321, 387, 555, 179, 228, 809, 955],
  "★ karambit | case hardened": [387, 442, 269, 321, 698, 179, 151, 828, 892],
  "★ m9 bayonet | case hardened": [601, 321, 387, 555, 670, 151],
  "★ bayonet | case hardened": [555, 321, 387, 151, 670],
  "five-seveN | case hardened": [690, 387, 321, 151],
};

const CH_SEEDS = new Set([
  151, 179, 228, 269, 321, 387, 442, 555, 601, 661, 670, 690, 698, 809, 828, 892, 955,
]);

const WEAR_CAP = [0.07, 0.15, 0.38, 0.45, 1];

function family(name: string) {
  return name.toLowerCase().replace(/\s+\((factory new|minimal wear|field-tested|well-worn|battle-scarred)\)$/i, "");
}

function gemVersion(version: string | undefined) {
  if (!version) return null;
  const v = version.trim().toLowerCase();
  if (GEM_VERSION.has(v)) return version.trim();
  return null;
}

export function crazyFloatTag(fv: number | undefined): string | null {
  if (fv == null || !Number.isFinite(fv) || fv < 0 || fv > 1) return null;
  if (fv > 0 && fv < 0.001) return `0.00 fv ${fv.toFixed(6)}`;
  if (fv >= 0.99) return `0.99 fv ${fv.toFixed(6)}`;
  const digits = fv.toFixed(8);
  if (/^0\.0{3,}/.test(digits)) return `0.00 fv ${fv.toFixed(6)}`;
  if (/9{4,}/.test(digits.replace(".", ""))) return `nines ${fv.toFixed(6)}`;
  for (const cap of WEAR_CAP) {
    if (fv < cap && cap - fv <= 0.00015) return `max fv ${fv.toFixed(6)}`;
  }
  return null;
}

function fadeTag(listing: Listing): string | null {
  const fade = listing.fadePct;
  if (fade != null && fade >= 97) return `fade ${fade.toFixed(1)}`;
  return null;
}

function chTag(listing: Listing): string | null {
  const n = listing.marketHashName.toLowerCase();
  if (!n.includes("case hardened") || listing.paintSeed == null) return null;
  const gems = GEM_SEEDS[family(listing.marketHashName)];
  if (gems?.includes(listing.paintSeed)) return `ch seed ${listing.paintSeed}`;
  if (CH_SEEDS.has(listing.paintSeed)) return `ch seed ${listing.paintSeed}`;
  return null;
}

export function matchPattern(
  listing: Listing,
  extraNames: string[],
  extraSeeds: number[],
  maxFloat: number,
): PatternHit | null {
  if (listing.minPrice == null || listing.quantity <= 0) return null;

  const bits: string[] = [];
  const crazy = crazyFloatTag(listing.floatValue);
  if (crazy) bits.push(crazy);
  const fade = fadeTag(listing);
  if (fade) bits.push(fade);
  const ch = chTag(listing);
  if (ch) bits.push(ch);

  const gem = gemVersion(listing.version);
  if (gem) {
    const off = discountPct(listing);
    const ask = listing.sellAsk;
    const cheap =
      (off != null && off >= config.patternPct) ||
      (ask != null && listing.minPrice < ask * (1 - config.patternPct / 100));
    if (cheap || bits.length) bits.unshift(gem);
  }

  if (bits.length) {
    return { tag: bits.join(" · "), seed: listing.paintSeed, floatValue: listing.floatValue };
  }

  if (listing.floatValue != null && maxFloat > 0 && listing.floatValue <= maxFloat) {
    return { tag: `low float ${listing.floatValue.toFixed(4)}`, floatValue: listing.floatValue, seed: listing.paintSeed };
  }

  if (listing.paintSeed != null) {
    if (extraSeeds.includes(listing.paintSeed)) {
      return { tag: `seed ${listing.paintSeed}`, seed: listing.paintSeed, floatValue: listing.floatValue };
    }
  }

  const n = listing.marketHashName.toLowerCase();
  const ver = (listing.version ?? "").toLowerCase();
  for (const raw of extraNames) {
    const token = raw.trim().toLowerCase();
    if (!token) continue;
    if (n.includes(token) || ver.includes(token)) {
      return { tag: token, seed: listing.paintSeed, floatValue: listing.floatValue };
    }
  }

  return null;
}

export function parseSeeds(text: string) {
  return text
    .split(/[,\s]+/)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 1000);
}
