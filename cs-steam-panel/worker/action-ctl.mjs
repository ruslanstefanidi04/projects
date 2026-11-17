// tracks held keys, gates play input, emergency release. dispatch stays in loop.
import { VK } from "./input.mjs";

export const PLAY_VKS = [VK.W, VK.A, VK.S, VK.D, VK.SPACE, VK.E];

export function makeActionController({ maxHoldMs = 8000 } = {}) {
  const held = new Map();

  function noteDown(vk) {
    const n = Number(vk);
    if (!n) return;
    held.set(n, Date.now());
  }

  function noteUp(vk) {
    held.delete(Number(vk));
  }

  function staleHolds(now = Date.now()) {
    const out = [];
    for (const [vk, t0] of held) {
      if (now - t0 > maxHoldMs) out.push(vk);
    }
    return out;
  }

  function allowPlay(gsi) {
    if (!gsi) return false;
    if (gsi.spectating || gsi.inMenu || gsi.activity === "menu" || gsi.activity === "textinput") return false;
    if (!gsi.alive) return false;
    return true;
  }

  function gateStep(step, gsi) {
    const a = String(step?.action || "").toUpperCase();
    if (a === "WAIT" || a === "KEYUP") return { ok: true, reason: "safe" };
    if (a === "CLICK" || a === "KEY") return { ok: true, reason: "ui" };
    if (!allowPlay(gsi)) return { ok: false, reason: "gated" };
    return { ok: true, reason: "play" };
  }

  function heldVks() {
    return [...held.keys()];
  }

  function clear() {
    held.clear();
  }

  return { noteDown, noteUp, staleHolds, allowPlay, gateStep, heldVks, clear, maxHoldMs };
}

export async function emergencyRelease(send, vks = PLAY_VKS) {
  const errors = [];
  for (const vk of vks) {
    try {
      await send("keyup", { vk });
    } catch (e) {
      errors.push(String(e.message || e));
    }
  }
  return { ok: errors.length === 0, errors };
}
