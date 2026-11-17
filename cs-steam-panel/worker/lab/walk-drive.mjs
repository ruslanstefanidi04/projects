// closed-loop walk: pose check, look+hold slices, stuck recover, release all.
import { appendFileSync, readFileSync } from "fs";
import path from "path";
import { FARM_ROOT } from "../vm/defaults.mjs";
import { VK } from "../input.mjs";
import { walkTick } from "./walk-plan.mjs";
import { readLab, stopLab } from "./state.mjs";
import { readPose, poseMoved } from "./pose.mjs";

const VISION = path.join(FARM_ROOT, "ops", "vision");
const LOG = path.join(VISION, "lab-walk.log");
const MAX_RECOVER = 3;

let timer = null;
let running = false;
let cfg = null;
let lastPose = null;
let lastMoveAt = 0;
let driveStartedAt = 0;
let recovers = 0;
let pulsing = false;
let lastStatus = { at: 0, reason: "", held: "", sent: [], error: "", guest: "", ticks: 0 };

function log(line) {
  try {
    appendFileSync(LOG, new Date().toISOString() + " " + line + "\n", "utf8");
  } catch {}
}

export function walkDriveStatus() {
  return { running, recovers, ...lastStatus };
}

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

async function guest(kind, extra = {}) {
  if (!cfg || !cfg.ip) return { ok: false, body: { error: "no-guest" }, out: "no-guest" };
  const ms = Number(extra.ms) || 0;
  const wait = kind === "hold" ? Math.max(4000, ms + 2500) : kind === "look" ? 6000 : 2500;
  try {
    const r = await fetch(`http://${cfg.ip}:${cfg.port}/input`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${cfg.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ kind, ...extra }),
      signal: AbortSignal.timeout(wait)
    });
    const body = await r.json().catch(() => ({}));
    const out = String(body.out || body.error || "");
    const ok = r.ok && body.ok !== false && out !== "no-cs2" && out !== "no-ps1" && out !== "timeout";
    return { ok, body, out, http: r.status };
  } catch (e) {
    return { ok: false, body: { error: String(e.message || e) }, out: String(e.message || e) };
  }
}

async function releaseKeys() {
  try {
    await guest("release");
  } catch {}
  for (const vk of [VK.W, VK.A, VK.S, VK.D, VK.SPACE]) {
    try {
      await guest("keyup", { vk });
    } catch {}
  }
}

export function walkDriveOn() {
  return running;
}

export async function stopWalkDrive() {
  running = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await releaseKeys();
}

async function haltWalk(reason) {
  running = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  stopLab(reason);
  await releaseKeys();
  log("halt " + reason + " recovers=" + recovers);
}

export async function pulseWalk() {
  if (pulsing) return lastStatus;
  pulsing = true;
  try {
    const frame = readJson(path.join(VISION, "frame.json"));
    const freezeJ = readJson(path.join(VISION, "radar-freeze.json"));
    const freeze = freezeJ && freezeJ.radar ? { radar: freezeJ.radar } : null;
    const gsi = readJson(path.join(VISION, "self.json"));
    const pose = readPose({ gsi, frame });
    const now = Date.now();
    if (pose.ok) {
      if (poseMoved(lastPose, pose)) lastMoveAt = now;
      if (!lastPose) lastMoveAt = now;
      lastPose = pose;
    }
    const grace = now - driveStartedAt < 900;
    const stuckMs = grace || !lastMoveAt ? 0 : now - lastMoveAt;
    if (!pose.ok) {
      await haltWalk("no-pose");
      return { ok: false, reason: "no-pose", sent: [], lab: readLab() };
    }
    if (now - driveStartedAt > 45000) {
      await haltWalk("timeout");
      return { ok: true, reason: "timeout", sent: [], lab: readLab() };
    }
    if (stuckMs > 2200) {
      recovers += 1;
      log("stuck recover=" + recovers);
      await releaseKeys();
      await guest("look", { dx: 180, dy: 0 });
      lastMoveAt = now;
      if (recovers > MAX_RECOVER) {
        await haltWalk("stuck");
        return { ok: false, reason: "stuck", sent: [], lab: readLab() };
      }
    }
    const tick = walkTick({ frame, freeze, gsi, stuckMs });
    const d = tick.decision || {};
    const steps = Array.isArray(d.steps) ? d.steps : [];
    if (d.action !== "COMBO" || !steps.length) {
      await haltWalk(d.reason || "idle");
      lastStatus = { at: now, reason: d.reason || tick.skill, held: "", sent: [], ticks: (lastStatus.ticks || 0) + 1 };
      return { ok: true, reason: d.reason || tick.skill, sent: [], lab: readLab() };
    }
    const sent = [];
    for (const step of steps) {
      const a = String(step.action || "").toUpperCase();
      if (a === "LOOK") sent.push({ kind: "look", ...(await guest("look", { dx: step.dx || 0, dy: step.dy || 0 })) });
      if (a === "HOLD") {
        const vk = VK[String(step.key || "W").toUpperCase()] || VK.W;
        sent.push({ kind: "hold", key: step.key, ...(await guest("hold", { vk, ms: Math.min(280, Number(step.ms) || 280) })) });
      }
    }
    const n = (lastStatus.ticks || 0) + 1;
    lastStatus = {
      at: Date.now(),
      reason: d.reason || tick.skill,
      held: "",
      sent,
      error: sent.find((s) => s.ok === false)?.out || "",
      guest: (sent[0] || {}).out || "",
      ticks: n,
      pose: { nx: pose.nx, ny: pose.ny, yaw: pose.yaw, conf: pose.confidence, src: pose.source }
    };
    log("tick=" + n + " stuck=" + stuckMs + " rec=" + recovers + " pose=" + pose.source + " conf=" + pose.confidence);
    return { ok: !lastStatus.error, reason: lastStatus.reason, sent, lab: readLab() };
  } finally {
    pulsing = false;
  }
}

function schedule() {
  if (!running) return;
  timer = setTimeout(async () => {
    if (!running) return;
    try {
      const lab = readLab();
      if (lab.skill !== "walk" || !lab.confirmed) {
        log("drive stop skill=" + lab.skill + " stop=" + lab.stopReason);
        await releaseKeys();
        running = false;
        return;
      }
      await pulseWalk();
    } catch (e) {
      log("pulse " + String(e.message || e));
    }
    schedule();
  }, 60);
}

export async function startWalkDrive({ ip, port, token } = {}) {
  await stopWalkDrive();
  cfg = { ip, port, token };
  lastStatus.ticks = 0;
  lastPose = null;
  lastMoveAt = 0;
  recovers = 0;
  driveStartedAt = Date.now();
  log("drive start ip=" + ip);
  running = true;
  const first = await pulseWalk();
  schedule();
  return first;
}

export async function nudgeWalk({ ip, port, token, ms = 900 } = {}) {
  await stopWalkDrive();
  cfg = { ip, port, token };
  const wait = Math.max(200, Number(ms) || 900);
  const hold = await guest("hold", { vk: VK.W, ms: wait });
  await guest("release");
  lastStatus = { at: Date.now(), reason: "nudge-w", held: "", sent: [{ kind: "hold", ok: hold.ok, out: hold.out }], ticks: 1 };
  return { ok: hold.ok, down: hold, up: { ok: true }, sample: "", lab: readLab() };
}
