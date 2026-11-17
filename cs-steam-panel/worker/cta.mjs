import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const visionDir = "D:/FarmVMs/ops/vision";

/** read last full-res green-CTA detect from guest capture */
export function readCtaSpots() {
  const p = path.join(visionDir, "shot.json");
  if (!existsSync(p)) return { ok: false, spots: [], reason: "no-shot-json" };
  try {
    const j = JSON.parse(readFileSync(p, "utf8"));
    const spots =
      Array.isArray(j.greens) && j.greens.length
        ? j.greens
        : Array.isArray(j.spots)
          ? j.spots
          : [];
    return {
      ok: Boolean(j.ok) && !j.black && spots.length > 0,
      w: j.w,
      h: j.h,
      mean: j.mean,
      spots,
      best: spots[0] || null,
      png: path.join(visionDir, "live.png"),
      black: Boolean(j.black),
      src: j.via || "guest"
    };
  } catch (e) {
    return { ok: false, spots: [], reason: String(e.message || e) };
  }
}

export function pickTrainingClick(spots) {
  if (!spots || !spots.length) return null;
  // ignore left promo / store BUY strip
  const usable = spots.filter((s) => s.x > 18 && s.x < 92 && s.y > 12);
  const pool = usable.length ? usable : spots;
  // prefer left-mid Training Day GO tile (not far-left Armory), else bottom-right GO
  const left = pool.filter((s) => s.x > 18 && s.x <= 45 && s.y >= 28 && s.y <= 60);
  if (left.length) return left.sort((a, b) => b.score - a.score)[0];
  const br = pool.filter((s) => s.x >= 70 && s.y >= 75);
  if (br.length) return br.sort((a, b) => b.score - a.score)[0];
  return pool[0];
}

export function markClick(note) {
  try {
    mkdirSync(visionDir, { recursive: true });
    writeFileSync(path.join(visionDir, "last-click.txt"), `${new Date().toISOString()} ${note}\n`);
  } catch {}
}
