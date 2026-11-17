// single policy switch. guest input stays guest-input. no second game loop.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { pickAction } from "./learn.mjs";
import { FARM_ROOT } from "./vm/defaults.mjs";

export const POLICY_IDS = ["fsm", "bandit", "bc", "skills", "walk", "aim", "fire", "teapearce", "p2p", "csrl"];
export const POLICY_FILE = path.join(FARM_ROOT, "ops", "vision", "policy.json");
export const ACTIVATE_FILE = path.join(FARM_ROOT, "ops", "vision", "policy-activate.json");

export function readActivate() {
  try {
    if (!existsSync(ACTIVATE_FILE)) return null;
    return JSON.parse(readFileSync(ACTIVATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

export function activePolicyId() {
  const env = String(process.env.FARM_POLICY || "").toLowerCase().trim();
  if (POLICY_IDS.includes(env)) return env;
  const act = readActivate();
  if (act?.confirmed && POLICY_IDS.includes(String(act.id || "").toLowerCase())) {
    return String(act.id).toLowerCase();
  }
  return "fsm";
}

export function setPolicyId(id) {
  const next = String(id || "fsm").toLowerCase().trim();
  const ok = POLICY_IDS.includes(next) ? next : "fsm";
  mkdirSync(path.dirname(POLICY_FILE), { recursive: true });
  writeFileSync(
    POLICY_FILE,
    JSON.stringify({ id: ok, at: new Date().toISOString(), pending: ok !== "fsm" }, null, 2),
    "utf8"
  );
  return ok;
}

export function confirmPolicy(id) {
  const ok = setPolicyId(id);
  mkdirSync(path.dirname(ACTIVATE_FILE), { recursive: true });
  writeFileSync(
    ACTIVATE_FILE,
    JSON.stringify({ id: ok, confirmed: true, at: new Date().toISOString() }, null, 2),
    "utf8"
  );
  return ok;
}

export function stepsFromLabel(label) {
  const a = String(label || "wait");
  if (a === "wait" || a === "idle") return [{ action: "WAIT", ms: 80 }];
  if (a === "fire") return [{ action: "FIRE" }];
  if (a.startsWith("walk-")) {
    const keys = a.slice(5).toUpperCase().split("");
    return keys.filter((k) => "WASD".includes(k)).map((k) => ({ action: "KEYDOWN", key: k }));
  }
  return [{ action: "WAIT", ms: 80 }];
}

export function preferFromPolicy({ id, obs, weights, key, explore, allow, bcPredict }) {
  const p = id || activePolicyId();
  if (p === "fsm") return { source: "fsm", action: null, ok: true };
  if (p === "bandit") {
    const action = pickAction(weights, key, { explore, allow });
    return { source: "bandit", action, ok: true };
  }
  if (p === "bc") {
    if (typeof bcPredict !== "function") {
      return { source: "bc", action: null, ok: false, reason: "no-bc-model" };
    }
    const action = bcPredict({ observation: obs, keys: {} });
    return { source: "bc", action, ok: Boolean(action), reason: action ? null : "empty-pred" };
  }
  return {
    source: p,
    action: null,
    ok: false,
    reason: "pretrained-not-loaded",
    note: "see docs/PRETRAINED_CANDIDATES.md"
  };
}

export function choosePrefer({ stack, prompt, rules, weights, key, explore, allow, bcPredict, obs, policyId }) {
  const id = policyId || activePolicyId();
  if (id === "bc") {
    const t0 = Date.now();
    const r = preferFromPolicy({ id, obs, bcPredict });
    r.inference_ms = Date.now() - t0;
    if (r.ok && r.action) return r;
    return {
      source: "bc-fallback",
      action: "wait",
      ok: false,
      reason: r.reason || "bc-failed",
      inference_ms: r.inference_ms
    };
  }
  if (stack?.prompt !== false && prompt) return { source: "prompt", action: prompt, ok: true };
  if (id === "bandit") {
    const r = preferFromPolicy({ id, weights, key, explore, allow });
    if (r.ok && r.action) return r;
  }
  if (stack?.rules !== false && rules) return { source: "rules", action: rules, ok: true };
  if (stack?.rl !== false) {
    const action = pickAction(weights, key, { explore, allow });
    return { source: "bandit", action, ok: true };
  }
  return { source: "fallback", action: stack?.move !== false ? "strafe-advance" : "wait", ok: true };
}
