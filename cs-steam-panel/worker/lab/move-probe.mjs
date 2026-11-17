import { readFileSync } from "fs";
import path from "path";
import { FARM_ROOT } from "../vm/defaults.mjs";
import { VK } from "../input.mjs";
import { readPose, poseMoved } from "./pose.mjs";

const VISION = path.join(FARM_ROOT, "ops", "vision");

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

async function guest(ip, port, token, kind, extra = {}) {
  const ms = Number(extra.ms) || 0;
  const wait = kind === "hold" ? ms + 2500 : 4000;
  const r = await fetch(`http://${ip}:${port}/input`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ kind, ...extra }),
    signal: AbortSignal.timeout(wait)
  });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok && body.ok !== false, out: String(body.out || body.error || ""), body };
}

function snap() {
  const frame = readJson(path.join(VISION, "frame.json"));
  const gsi = readJson(path.join(VISION, "self.json"));
  return readPose({ gsi, frame });
}

export async function runMoveProbe({ ip, port, token } = {}) {
  const started = Date.now();
  const steps = [];
  const before = snap();
  steps.push({ name: "pose-before", pose: before });
  if (!before.ok) {
    await guest(ip, port, token, "release");
    return { ok: false, reason: before.reason || "no-pose", ms: Date.now() - started, steps, moved: false };
  }
  const w = await guest(ip, port, token, "hold", { vk: VK.W, ms: 2000 });
  steps.push({ name: "hold-w-2s", ...w });
  const afterW = snap();
  const moved = poseMoved(before, afterW);
  steps.push({ name: "pose-after-w", pose: afterW, moved });
  const look = await guest(ip, port, token, "look", { dx: 400, dy: 0 });
  steps.push({ name: "look", ...look });
  const afterLook = snap();
  const yawChanged =
    before.yawOk && afterLook.yawOk ? Math.abs(((afterLook.yaw - before.yaw + 540) % 360) - 180) > 4 : null;
  steps.push({ name: "pose-after-look", pose: afterLook, yawChanged });
  const a = await guest(ip, port, token, "hold", { vk: VK.A, ms: 350 });
  steps.push({ name: "hold-a", ...a });
  const d = await guest(ip, port, token, "hold", { vk: VK.D, ms: 350 });
  steps.push({ name: "hold-d", ...d });
  const jump = await guest(ip, port, token, "hold", { vk: VK.SPACE, ms: 120 });
  steps.push({ name: "jump", ...jump });
  const rel = await guest(ip, port, token, "release");
  steps.push({ name: "release", ...rel });
  const end = snap();
  return {
    ok: moved === true,
    reason: moved ? "moved" : "no-world-delta",
    ms: Date.now() - started,
    moved,
    yawChanged,
    start: before,
    end,
    steps
  };
}
