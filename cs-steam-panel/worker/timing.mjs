// clock brain: gsi ammo / bomb / freeze, not pixels. signals go to hands.
import { isT } from "./round-clock.mjs";

export function pickTiming(g, mode = "urgent") {
  if (!g || !g.alive) return null;
  const planted =
    g.bomb === "planted" ||
    g.bombState === "planted" ||
    g.bombState === "exploding";
  const cd = Number(g.bombCountdown || 0);
  if (mode === "urgent" && planted && cd > 0 && cd <= 8) {
    const t = isT(g.team);
    if (t || cd <= 5) {
      return {
        kind: "run",
        action: "walk-s",
        why: "bomb-" + cd.toFixed(1) + "s",
        bombCd: cd
      };
    }
  }
  const skipGun = /Knife|C4|Grenade/i.test(String(g.weaponType || ""));
  const clip = Number(g.ammo || 0);
  const reserve = Number(g.ammoReserve || 0);
  if (skipGun) return null;
  if (mode === "urgent" && clip <= 0 && reserve > 0) {
    return { kind: "reload", action: "reload", why: "clip-0", clip, reserve };
  }
  if (mode === "soft" && clip <= 2 && reserve > 0) {
    return { kind: "reload", action: "reload", why: "clip-" + clip, clip, reserve };
  }
  return null;
}

export function timingView(g) {
  const planted =
    g?.bomb === "planted" ||
    g?.bombState === "planted" ||
    g?.bombState === "exploding";
  return {
    clip: Number(g?.ammo || 0),
    reserve: Number(g?.ammoReserve || 0),
    bomb: planted ? Number(g?.bombCountdown || 0) : 0,
    planted: Boolean(planted),
    freeze: g?.phase === "freezetime" || g?.mapPhase === "freezetime",
    clock: g?.clock || "",
    roundTime: Number(g?.roundTime || 0),
    urgent: pickTiming(g, "urgent"),
    soft: pickTiming(g, "soft")
  };
}
