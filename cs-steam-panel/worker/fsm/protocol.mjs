// tick + action lifecycle protocol (obs/action journal). no learning here.
import { appendFileSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import path from "path";
import { createHash } from "crypto";

const VISION = "D:/FarmVMs/ops/vision";
const JOURNAL = path.join(VISION, "ticks.jsonl");
const LATENCY = path.join(VISION, "latency.json");
const LAST_TICK = path.join(VISION, "tick.json");

/** @typedef {'CREATED'|'DISPATCHED'|'ACKNOWLEDGED'|'VERIFIED'|'FAILED'|'TIMEOUT'} ActionStatus */

let tickSeq = 0;
const episodeId = `ep-${Date.now().toString(36)}`;
/** @type {Record<string, number[]>} */
const latSamples = {
  capture_ms: [],
  transfer_ms: [],
  cv_ms: [],
  decision_ms: [],
  input_ms: [],
  verify_ms: [],
  cycle_ms: []
};

function pushSample(key, ms) {
  const arr = latSamples[key];
  if (!arr) return;
  arr.push(Math.max(0, Math.round(ms)));
  if (arr.length > 400) arr.splice(0, arr.length - 400);
}

function pct(arr, p) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.floor((p / 100) * s.length)));
  return s[i];
}

export function latencySnapshot() {
  const out = {};
  for (const [k, arr] of Object.entries(latSamples)) {
    out[k] = {
      n: arr.length,
      p50: pct(arr, 50),
      p95: pct(arr, 95),
      p99: pct(arr, 99),
      last: arr.length ? arr[arr.length - 1] : null
    };
  }
  return out;
}

export function saveLatency() {
  try {
    mkdirSync(VISION, { recursive: true });
    writeFileSync(LATENCY, JSON.stringify({ at: new Date().toISOString(), ...latencySnapshot() }, null, 2));
  } catch {}
}

export function frameHashFromBuf(buf) {
  if (!buf || !buf.length) return null;
  return createHash("md5").update(buf.subarray(0, Math.min(buf.length, 65536))).digest("hex").slice(0, 12);
}

export function beginTick(vmId = "csfarm-golden") {
  tickSeq += 1;
  const now = Date.now();
  return {
    tick_id: tickSeq,
    episode_id: episodeId,
    vm_id: vmId,
    t0: now,
    capture: { frame_id: null, timestamp_ms: null, valid: false, latency_ms: null },
    observation: null,
    confirmed: null,
    action: null,
    latency: {},
    result: null
  };
}

export function markCapture(tick, meta) {
  const ts = Date.now();
  tick.capture = {
    frame_id: meta.frame_id ?? tick.tick_id,
    timestamp_ms: meta.timestamp_ms ?? ts,
    valid: Boolean(meta.valid),
    latency_ms: meta.latency_ms ?? null,
    age_ms: meta.age_ms ?? null,
    frame_hash: meta.frame_hash ?? null,
    black_ratio: meta.black_ratio ?? null,
    mean: meta.mean ?? null,
    error: meta.error ?? null
  };
  if (meta.latency_ms != null) {
    tick.latency.capture_ms = meta.latency_ms;
    pushSample("capture_ms", meta.latency_ms);
  }
  if (meta.transfer_ms != null) {
    tick.latency.transfer_ms = meta.transfer_ms;
    pushSample("transfer_ms", meta.transfer_ms);
  }
}

export function markObservation(tick, obs, cvMs) {
  tick.observation = obs;
  if (cvMs != null) {
    tick.latency.cv_ms = cvMs;
    pushSample("cv_ms", cvMs);
  }
}

export function markConfirmed(tick, confirmed) {
  tick.confirmed = confirmed;
}

export function createAction(tick, decision) {
  const id = `action-${tick.tick_id}`;
  tick.action = {
    id,
    status: /** @type {ActionStatus} */ ("CREATED"),
    decision,
    created_at: Date.now(),
    dispatched_at: null,
    acked_at: null,
    verified_at: null,
    ack_ok: null,
    verify_ok: null,
    verify_detail: null,
    error: null
  };
  return tick.action;
}

export function setActionStatus(tick, status, extra = {}) {
  if (!tick.action) return;
  tick.action.status = status;
  const now = Date.now();
  if (status === "DISPATCHED") tick.action.dispatched_at = now;
  if (status === "ACKNOWLEDGED") {
    tick.action.acked_at = now;
    tick.action.ack_ok = extra.ok !== false;
  }
  if (status === "VERIFIED") {
    tick.action.verified_at = now;
    tick.action.verify_ok = true;
    tick.action.verify_detail = extra.detail ?? null;
  }
  if (status === "FAILED" || status === "TIMEOUT") {
    tick.action.error = extra.error || status;
    tick.action.verify_ok = false;
    tick.action.verify_detail = extra.detail ?? null;
  }
  Object.assign(tick.action, extra.fields || {});
}

export function markLatency(tick, key, ms) {
  tick.latency[key] = Math.round(ms);
  pushSample(key, ms);
}

export function finishTick(tick, result = {}) {
  tick.result = result;
  tick.latency.cycle_ms = Date.now() - tick.t0;
  pushSample("cycle_ms", tick.latency.cycle_ms);
  const row = {
    tick_id: tick.tick_id,
    episode_id: tick.episode_id,
    vm_id: tick.vm_id,
    at: new Date().toISOString(),
    capture: tick.capture,
    confirmed: tick.confirmed,
    observation: tick.observation
      ? {
          screen: tick.observation.screen,
          confidence: tick.observation.confidence,
          mean: tick.observation.mean,
          estimates: tick.observation.estimates || null
        }
      : null,
    action: tick.action
      ? {
          id: tick.action.id,
          status: tick.action.status,
          reason: tick.action.decision?.reason,
          kind: tick.action.decision?.action,
          ack_ok: tick.action.ack_ok,
          verify_ok: tick.action.verify_ok,
          verify_detail: tick.action.verify_detail,
          error: tick.action.error
        }
      : null,
    latency: tick.latency,
    result: tick.result
  };
  try {
    mkdirSync(VISION, { recursive: true });
    appendFileSync(JOURNAL, JSON.stringify(row) + "\n");
    writeFileSync(LAST_TICK, JSON.stringify(tick, null, 2));
    if (tick.tick_id % 8 === 0) saveLatency();
  } catch {}
  return row;
}

export function readLastTick() {
  try {
    if (!existsSync(LAST_TICK)) return null;
    return JSON.parse(readFileSync(LAST_TICK, "utf8"));
  } catch {
    return null;
  }
}

export { episodeId, VISION as PROTOCOL_VISION };
