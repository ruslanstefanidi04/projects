// inspect CS-RL IQL checkpoint without torch.load / pickle.
import { writeFileSync, mkdirSync } from "fs";
import path from "path";
import { FARM_ROOT } from "./vm/defaults.mjs";

const CFG_URL =
  "https://raw.githubusercontent.com/wyhong3103/cs-rl-agent/main/artifacts/models/offline/config.json";
const PTH_URL =
  "https://raw.githubusercontent.com/wyhong3103/cs-rl-agent/main/artifacts/models/offline/p_network.pth";

const out = {
  at: new Date().toISOString(),
  loaded_weights: false,
  unsafe_torch_load: false,
  config: null,
  header: null,
  compatible: false,
  blockers: []
};

try {
  const r = await fetch(CFG_URL, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("config http " + r.status);
  out.config = await r.json();
} catch (e) {
  out.blockers.push("config-fetch: " + (e.message || e));
}

try {
  const r = await fetch(PTH_URL, { method: "GET", signal: AbortSignal.timeout(20000), headers: { range: "bytes=0-15" } });
  const buf = Buffer.from(await r.arrayBuffer());
  const mag = buf.slice(0, 4).toString("latin1");
  out.header = { bytes: buf.length, magic: mag, hex: buf.toString("hex") };
  if (mag.startsWith("PK")) out.header.format = "zip-maybe-torch-zip";
  else if (buf[0] === 0x80) out.header.format = "pickle";
  else out.header.format = "unknown";
} catch (e) {
  out.blockers.push("pth-header: " + (e.message || e));
}

if (out.config) {
  out.blockers.push("obs: occupancy_grid 30x30 + 13-d GSI, not our packObservation");
  out.blockers.push("act: cate 7 + cont 1, not walk-w labels");
  out.blockers.push("input: host PressKey, not guest-input");
  out.blockers.push("device: " + out.config.device);
}

mkdirSync(path.join(FARM_ROOT, "ops", "eval"), { recursive: true });
writeFileSync(path.join(FARM_ROOT, "ops", "eval", "iql-inspect.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
