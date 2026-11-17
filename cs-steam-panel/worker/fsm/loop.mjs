// farm loop: transactional tick (capture -> cv -> confirm -> decide -> input -> verify)
import { spawnSync } from "child_process";
import { existsSync, writeFileSync, mkdirSync, appendFileSync, readFileSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { setVisionAgent, pullGuestVision, senseClick, senseKey, senseHold } from "../vision.mjs";
import { ensureCvWorker } from "../cv-worker.mjs";
import { VK } from "../input.mjs";
import { decide, nextState, readFrame, writeDecision, verifyExpect } from "./decision.mjs";
import { packObservation, obsActionable } from "../obs.mjs";
import { makeActionController, emergencyRelease, PLAY_VKS } from "../action-ctl.mjs";
import {
  beginTick,
  markCapture,
  markObservation,
  markConfirmed,
  createAction,
  setActionStatus,
  markLatency,
  finishTick,
  saveLatency,
  frameHashFromBuf,
  latencySnapshot,
  episodeId
} from "./protocol.mjs";
import { applyMouseToView, yawFromForward } from "../aim-gsi.mjs";
import { startGsi, parseGsi, gsiRadar } from "../gsi.mjs";
import { preferByRules, preferByPrompt, readLivePrompt, readLiveIntent } from "../play-policy.mjs";
import { brainAppend } from "../brain-log.mjs";
import { readStack } from "../brain-cfg.mjs";
import { pickRoute } from "../brain.mjs";
import { tickClock, isT, isDeathmatch } from "../round-clock.mjs";
import { timingView } from "../timing.mjs";
import { radarZone, leftSpawn, atSite, steerWaypoint } from "../radar-zones.mjs";
import { buyMenuSeq, buyMenuKeys, alreadyArmed, runBuyMenu, buyHint } from "./buy.mjs";
import { makeRewardTracker } from "../reward.mjs";
import { loadWeights, saveWeights, stateKey, learn, reasonToAction, LIVE_MOVE, LIVE_FIGHT, LIVE_DM } from "../learn.mjs";
import { choosePrefer, activePolicyId } from "../policy-router.mjs";
import { runHierarchy } from "../skills/hierarchy.mjs";
import { readLab } from "../lab/state.mjs";
import { walkTick } from "../lab/walk-plan.mjs";
import { loadBcModel } from "../bc.mjs";
import { readLock } from "../grade.mjs";
import { sleep } from "../pace.mjs";
import { setConHost, setConBox, conExec } from "../con.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VISION = "D:/FarmVMs/ops/vision";
const SELF = path.join(VISION, "self.json");
const TIMING = path.join(VISION, "timing.json");
const BC_MODEL = process.env.FARM_BC_MODEL || "D:/FarmVMs/ops/bc/model.json";
let bcPredictCached = undefined;
function bcPredictFn() {
  if (bcPredictCached === undefined) {
    const m = loadBcModel(BC_MODEL);
    bcPredictCached = m ? (row) => m.predict(row) : null;
  }
  return bcPredictCached;
}
function skillRun(frame, gsi, stuckMs) {
  const lab = readLab();
  if (String(process.env.FARM_WALK_LIVE || "") === "1" && lab.goal && lab.confirmed) {
    return walkTick({ frame, gsi, stuckMs });
  }
  if (lab.skill === "walk" && lab.confirmed) {
    return walkTick({ frame, gsi, stuckMs });
  }
  if (String(process.env.FARM_LEGACY_FSM || "") === "1") {
    const id = activePolicyId();
    if (id !== "skills" && id !== "walk" && id !== "aim" && id !== "fire") return null;
    const force = id === "skills" ? null : id;
    return runHierarchy({ frame, gsi, stuckMs, force });
  }
  return {
    skill: "idle",
    source: "lab",
    ok: true,
    decision: { fsm: "lab", action: "WAIT", reason: "lab-idle", timeout_ms: 200 }
  };
}
function writePolicyLive(picked) {
  try {
    writeFileSync(
      path.join(VISION, "policy-live.json"),
      JSON.stringify(
        {
          source: picked?.source || "unknown",
          action: picked?.action || null,
          ok: Boolean(picked?.ok),
          reason: picked?.reason || null,
          inference_ms: picked?.inference_ms ?? null,
          at: new Date().toISOString()
        },
        null,
        2
      )
    );
  } catch {}
}
const PY = process.env.FARM_PYTHON || "C:/Users/R00/AppData/Local/Programs/Python/Python312/python.exe";
const ENGINE = path.join(__dirname, "..", "cv", "engine.py");
const LOG = path.join(VISION, "fsm.log");
const THINK = path.join(VISION, "think.log");
const THINK_JSON = path.join(VISION, "think-last.json");
const VM_ID = process.env.FARM_VM_ID || "csfarm-golden";

const ip = process.env.FARM_GOLDEN_IP || "10.250.0.10";
const agentToken = process.env.FARM_AGENT_TOKEN || "csfarm";
const agentPort = Number(process.env.FARM_AGENT_PORT || 39200);
setVisionAgent(ip, agentToken, agentPort);

const gsiPort = Number(process.env.BOT_GSI_PORT || 32222);
/** live GSI hp for instant damage react (before slow capture) */
let liveHp = null;
let liveArmor = null;
let liveAlive = false;
let dmgPending = 0;
const gsi = startGsi({
  port: gsiPort,
  token: process.env.BOT_GSI_TOKEN || "csfarm",
  host: process.env.FARM_GSI_BIND || "10.250.0.1",
  onState: (raw) => {
    try {
      const s = parseGsi(raw);
      if (liveHp != null && s.alive && liveAlive) {
        const drop = Math.max(0, liveHp - s.health) + Math.max(0, Math.floor(((liveArmor ?? s.armor) - s.armor) / 2));
        if (drop >= 1) dmgPending = Math.max(dmgPending, drop);
      }
      liveHp = s.health;
      liveArmor = s.armor;
      liveAlive = Boolean(s.alive);
    } catch {}
  }
});
const rewards = makeRewardTracker({ source: "agent" });
const ctl = makeActionController({ maxHoldMs: 8000 });
let weights = loadWeights();
let lockAtSeen = "";

function lockNow() {
  return readLock();
}

function syncLockWeights() {
  const L = lockNow();
  if (L.at && L.at !== lockAtSeen) {
    lockAtSeen = L.at;
    if (L.vote === "bad") weights = loadWeights();
  }
  return L;
}

function exploreRate(seen) {
  if (lockNow().freeze) return 0;
  return seen > 80 ? 0.06 : 0.14;
}

function maybeLearn(key, action, scored) {
  if (!scored?.learn || !key) return;
  if (lockNow().freeze) return;
  const pol = activePolicyId();
  if (pol !== "fsm" && pol !== "bandit") return;
  learn(weights, key, action, scored.sparse);
  try {
    writeFileSync(path.join(VISION, "last-reward.json"), JSON.stringify({ at: Date.now(), ...scored }, null, 2));
  } catch {}
}
try {
  setConHost(ip);
  setConBox("vmfarm");
  conExec("m_rawinput 0").catch(() => {});
} catch {}
let lastSave = 0;
let pending = { key: "live_open_clear", action: "explore" };
let lastFrameHash = null;
let captureErrors = 0;
let busy = false;
const clockMem = {};

function livePool(gsiState, { ammoDrop = 0, clock = "mid" } = {}) {
  if (clock === "dm") return [...LIVE_DM];
  if (clock === "execute") return ["explore", "strafe-advance", "radar-open"];
  if (clock === "planted" && !isT(gsiState?.team)) {
    return ["defuse", "strafe-advance", "explore", "radar-open"];
  }
  if (clock === "planted") return ["fight-push", "strafe-advance", "explore", "check-corner"];
  if (ammoDrop >= 1) return [...LIVE_FIGHT];
  return [...LIVE_MOVE];
}

function log(line) {
  const s = `${new Date().toISOString()} ${line}`;
  console.log(s);
  try {
    mkdirSync(VISION, { recursive: true });
    appendFileSync(LOG, s + "\n");
    brainAppend("fsm", { text: line });
  } catch {}
}

function think(obj) {
  const see = obj.see || "";
  const why = obj.why || "";
  const act = obj.do || "";
  const line = `${new Date().toISOString()} SEE ${see} | WHY ${why} | DO ${act}`;
  console.log(line);
  try {
    mkdirSync(VISION, { recursive: true });
    appendFileSync(THINK, line + "\n");
    writeFileSync(THINK_JSON, JSON.stringify({ ...obj, at: new Date().toISOString() }, null, 2));
    brainAppend("think", { see, why, do: act, reason: obj.reason || "" });
  } catch {}
}

function runCv() {
  const t0 = Date.now();
  ensureCvWorker();
  const out = path.join(VISION, "frame.json");
  try {
    if (existsSync(out)) {
      const age = Date.now() - statSync(out).mtimeMs;
      const frame = readFrame();
      if (frame?.ok && age < 2800) return { frame, ms: Date.now() - t0, via: "worker" };
    }
  } catch {}
  const r = spawnSync(
    PY,
    [ENGINE, "--image", path.join(VISION, "live.png"), "--out", out],
    { encoding: "utf8", windowsHide: true, timeout: 8000 }
  );
  const ms = Date.now() - t0;
  if (r.status !== 0) {
    log(`cv-fail ${r.stderr || r.stdout || r.status}`);
    return { frame: null, ms, via: "sync-fail" };
  }
  return { frame: readFrame(), ms, via: "sync" };
}

function writeSelf(gsi) {
  const team = String(gsi?.team || "");
  const t = isT(team);
  try {
    writeFileSync(
      SELF,
      JSON.stringify({
        team,
        t,
        dm: Boolean(gsi?.dm),
        foe: gsi?.dm ? "all" : t ? "CT" : team ? "T" : "",
        ally: gsi?.dm ? "none" : t ? "T" : team ? "CT" : "",
        ammo: Number(gsi?.ammo || 0),
        ammoReserve: Number(gsi?.ammoReserve || 0),
        bomb: gsi?.bombState || gsi?.bomb || "",
        bombCountdown: Number(gsi?.bombCountdown || 0),
        clock: gsi?.clock || "",
        freeze: gsi?.phase === "freezetime" || gsi?.mapPhase === "freezetime",
        weapon: gsi?.weapon || "",
        hasStarGun: Boolean(gsi?.hasStarGun),
        alive: Boolean(gsi?.alive),
        spectating: Boolean(gsi?.spectating),
        map: String(gsi?.map || ""),
        phase: String(gsi?.phase || ""),
        activity: String(gsi?.activity || ""),
        inMenu: Boolean(gsi?.inMenu),
        pos: gsi?.pos || null,
        forward: gsi?.forward || null,
        health: Number(gsi?.health || 0),
        armor: Number(gsi?.armor || 0),
        money: Number(gsi?.money || 0),
        helmet: Boolean(gsi?.helmet),
        kit: Boolean(gsi?.kit),
        loadout: String(gsi?.loadout || ""),
        flashes: Number(gsi?.flashes || 0),
        smokes: Number(gsi?.smokes || 0),
        hes: Number(gsi?.hes || 0),
        molly: Number(gsi?.molly || 0),
        buy: buyHint(gsi)
      })
    );
    writeFileSync(TIMING, JSON.stringify(timingView(gsi), null, 2));
  } catch {}
}

async function hvInput(kind, extra = {}) {
  const url = "http://127.0.0.1:39201";
  try {
    if (kind === "look") {
      return { ok: false, body: { error: "look-not-on-hv" } };
    }
    if (kind === "fire") {
      const r = await fetch(url + "/click", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ x: 50, y: 52 }),
        signal: AbortSignal.timeout(8000)
      });
      const body = await r.json().catch(() => ({}));
      return { ok: Boolean(body.ok), body };
    }
    const path =
      kind === "keydown" ? "/keydown" : kind === "keyup" ? "/keyup" : kind === "hold" ? "/hold" : "/key";
    const r = await fetch(url + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vk: extra.vk, ms: extra.ms, text: extra.text }),
      signal: AbortSignal.timeout(8000)
    });
    const body = await r.json().catch(() => ({}));
    return { ok: Boolean(body.ok), body };
  } catch (e) {
    return { ok: false, body: { error: String(e.message || e) } };
  }
}

async function agentInput(kind, extra = {}) {
  try {
    const r = await fetch(`http://${ip}:${agentPort}/input?token=${encodeURIComponent(agentToken)}`, {
      method: "POST",
      headers: { authorization: `Bearer ${agentToken}`, "content-type": "application/json" },
      body: JSON.stringify({ kind, ...extra }),
      signal: AbortSignal.timeout(kind === "type" ? 8000 : kind === "look" ? 12000 : 2500)
    });
    const body = await r.json().catch(() => ({}));
    if (r.ok && body.ok !== false) return { ok: true, body };
    if (kind === "look" || kind === "fire") return { ok: false, body };
  } catch (e) {
    if (kind === "look" || kind === "fire") return { ok: false, body: { error: String(e.message || e) } };
  }
  return hvInput(kind, extra);
}

async function releaseAllKeys() {
  const vks = [...new Set([...ctl.heldVks(), ...PLAY_VKS])];
  await emergencyRelease((kind, extra) => agentInput(kind, extra), vks);
  ctl.clear();
}

async function tapVk(vk) {
  await agentInput("keydown", { vk });
  await sleep(35);
  await agentInput("keyup", { vk });
}

async function buyFromMenu(gsi) {
  return runBuyMenu(gsi, tapVk, sleep);
}

async function senseLook(dx, dy) {
  return agentInput("look", { dx: Math.round(dx), dy: Math.round(dy) });
}

async function applyStep(step, ctx) {
  const a = String(step.action || "").toUpperCase();
  const gate = ctl.gateStep(step, ctx.gsi || ctx.gsiForGate);
  if (!gate.ok) return { ok: true, skipped: gate.reason };
  if (a === "WAIT") {
    await sleep(step.ms || 100);
    return { ok: true };
  }
  if (a === "LOOK") {
    const r = await senseLook(step.dx || 0, step.dy || 0);
    if (!r || r.ok === false) log("look fail " + String((r && r.body && (r.body.out || r.body.error)) || "no"));
    if (r && r.ok !== false) {
      const next = applyMouseToView({ yaw: ctx.viewYaw || 0, pitch: ctx.viewPitch || 0 }, step.dx || 0, step.dy || 0);
      ctx.viewYaw = next.yaw;
      ctx.viewPitch = next.pitch;
    }
    return r;
  }
  if (a === "FIRE") {
    const r = await agentInput("fire", {});
    await sleep(35);
    return r;
  }
  if (a === "JUMP") {
    await agentInput("keydown", { vk: VK.SPACE });
    await sleep(Math.max(28, Math.min(60, step.ms || 36)));
    await agentInput("keyup", { vk: VK.SPACE });
    return { ok: true };
  }
  if (a === "KEYDOWN") {
    const map = { W: VK.W, A: VK.A, S: VK.S, D: VK.D, SPACE: VK.SPACE };
    const vk = map[step.key] || Number(step.key) || VK.W;
    ctl.noteDown(vk);
    await agentInput("keydown", { vk });
    return { ok: true };
  }
  if (a === "KEYUP") {
    const map = { W: VK.W, A: VK.A, S: VK.S, D: VK.D, SPACE: VK.SPACE };
    const vk = map[step.key] || Number(step.key) || VK.W;
    ctl.noteUp(vk);
    await agentInput("keyup", { vk });
    return { ok: true };
  }
  if (a === "HOLD") {
    const map = { W: VK.W, A: VK.A, S: VK.S, D: VK.D, E: VK.E };
    await senseHold(map[step.key] || VK.W, step.ms || 250);
    return { ok: true };
  }
  if (a === "CLICK") {
    const ok = await senseClick(step.x ?? 50, step.y ?? 50);
    await sleep(40);
    return { ok };
  }
  if (a === "KEY") {
    const map = { SPACE: VK.SPACE, ESC: VK.ESC, ENTER: VK.RETURN, R: 0x52, E: VK.E };
    await senseKey(map[step.key] || step.key);
    await sleep(40);
    return { ok: true };
  }
  return { ok: false };
}

async function runBunnyhop(d) {
  const hops = Math.max(2, Math.min(5, Number(d.hops) || 4));
  try {
    await agentInput("keydown", { vk: VK.W });
    for (let i = 0; i < hops; i++) {
      const left = i % 2 === 0;
      await agentInput("keydown", { vk: VK.SPACE });
      await sleep(32);
      await agentInput("keyup", { vk: VK.SPACE });
      await agentInput("keydown", { vk: left ? VK.A : VK.D });
      await senseLook(left ? -38 : 38, 0);
      // ~land window on 64-tick-ish feel; guest latency makes this approximate
      await sleep(300 + Math.floor(Math.random() * 70));
      await agentInput("keyup", { vk: left ? VK.A : VK.D });
    }
    await agentInput("keyup", { vk: VK.W });
    return true;
  } catch {
    try {
      await agentInput("keyup", { vk: VK.W });
      await agentInput("keyup", { vk: VK.A });
      await agentInput("keyup", { vk: VK.D });
      await agentInput("keyup", { vk: VK.SPACE });
    } catch {}
    return false;
  }
}

async function applyDecision(d, ctx) {
  writeDecision({ ...d, at: new Date().toISOString() });
  if (d.action === "WAIT") {
    await sleep(d.timeout_ms || 800);
    return { ok: true, acked: true };
  }
  if (d.action === "COMBO" && Array.isArray(d.steps)) {
    let ok = true;
    // bunnyhop needs W held across jumps
    if (d.reason === "bunnyhop" || d.bhop) {
      const r = await runBunnyhop(d);
      return { ok: r, acked: r };
    }
    for (const step of d.steps) {
      const r = await applyStep(step, ctx);
      if (r && r.ok === false) ok = false;
    }
    await sleep(d.timeout_ms || 40);
    return { ok, acked: ok };
  }
  if (d.action === "LOOK") {
    const r = await applyStep({ action: "LOOK", dx: d.dx, dy: d.dy }, ctx);
    return { ok: r.ok, acked: r.ok };
  }
  if (d.action === "CLICK") {
    const ok = await senseClick(d.x, d.y);
    log(`click ${d.target} ${d.x},${d.y} ok=${ok}`);
    await sleep(Math.min(1200, d.timeout_ms || 800));
    return { ok, acked: ok };
  }
  if (d.action === "KEY") {
    await applyStep({ action: "KEY", key: d.key }, ctx);
    return { ok: true, acked: true };
  }
  if (d.action === "HOLD") {
    const map = { W: VK.W, A: VK.A, S: VK.S, D: VK.D, E: VK.E };
    await senseHold(map[d.key] || VK.W, d.ms || 300);
    return { ok: true, acked: true };
  }
  return { ok: false, acked: false };
}

function decisionHasForward(d) {
  if (!d) return false;
  if (d.keepW) return true;
  if (d.action === "HOLD" && String(d.key || "").toUpperCase() === "W") return true;
  if (d.action === "COMBO" && Array.isArray(d.steps)) {
    return d.steps.some((s) => {
      const a = String(s.action || "").toUpperCase();
      const k = String(s.key || "").toUpperCase();
      return (a === "HOLD" && k === "W") || (a === "KEYDOWN" && k === "W");
    });
  }
  return false;
}

function captureHealthFromVision(vision, transferMs) {
  let buf = null;
  let age_ms = null;
  try {
    const p = path.join(VISION, "live.png");
    buf = readFileSync(p);
    age_ms = Date.now() - statSync(p).mtimeMs;
  } catch {}
  const hash = frameHashFromBuf(buf);
  const mean = Number(vision.mean || 0);
  const black_ratio = vision.black ? 1 : mean < 12 ? 0.95 : null;
  const repeated = Boolean(hash && hash === lastFrameHash && age_ms != null && age_ms > 2500);
  if (hash) lastFrameHash = hash;
  const valid = Boolean(vision.ok) && !vision.black && mean >= 2;
  if (!valid) captureErrors += 1;
  return {
    valid,
    mean,
    black_ratio,
    frame_hash: hash,
    age_ms: age_ms != null ? Math.round(age_ms) : null,
    repeated,
    transfer_ms: transferMs,
    capture_errors_total: captureErrors,
    error: valid ? null : vision.reason || (vision.black ? "black" : "invalid")
  };
}

async function cycle(state, ctx) {
  if (busy) {
    log("skip overlap-busy");
    return { state, ctx };
  }
  busy = true;
  syncLockWeights();
  const tick = beginTick(VM_ID);
  try {
    for (const vk of ctl.staleHolds()) {
      await agentInput("keyup", { vk });
      ctl.noteUp(vk);
      log("watchdog keyup " + vk);
    }
    const rawQuick = gsi.snapshot();
    const gsiAgeMs = gsi.receivedAt ? Date.now() - (gsi.receivedAt() || 0) : null;
    const gsiQuick = rawQuick ? parseGsi(rawQuick) : null;
    if (tick.tick_id <= 3 || tick.tick_id % 15 === 0) {
      log(
        `gsi snap=${Boolean(rawQuick)} map=${gsiQuick?.map || "-"} phase=${gsiQuick?.mapPhase || gsiQuick?.phase || "-"} alive=${gsiQuick?.alive} menu=${gsiQuick?.inMenu} dm=${gsiQuick ? isDeathmatch(gsiQuick) : false} act=${gsiQuick?.activity || "-"}`
      );
    }
    let hpDropFast = dmgPending;
    dmgPending = 0;
    if (gsiQuick && typeof liveHp === "number" && gsiQuick.alive) {
      // also compare snapshot vs last committed ctx
      if (typeof ctx.lastHp === "number") {
        hpDropFast = Math.max(hpDropFast, Math.max(0, ctx.lastHp - gsiQuick.health));
      }
    }
    if (hpDropFast >= 1 && gsiQuick?.alive) {
      const clockNow = tickClock(gsiQuick, clockMem).clock;
      // execute: do not spin on teammate noise; still turn if a real bullet
      if (clockNow === "execute" && hpDropFast < 8) {
        hpDropFast = 0;
      }
    }
    if (hpDropFast >= 1 && gsiQuick?.alive) {
      const nowDmg = Date.now();
      if (ctx.lastDmgReact && nowDmg - ctx.lastDmgReact < 900) {
        hpDropFast = 0;
      } else {
        ctx.lastDmgReact = nowDmg;
      }
      const turn = Math.random() < 0.5 ? 145 : -145;
      log(`tick=${tick.tick_id} FAST react-damage dmg=${hpDropFast} turn=${turn}`);
      createAction(tick, { action: "COMBO", reason: "react-damage-fast", steps: [] });
      setActionStatus(tick, "DISPATCHED");
      await senseLook(turn > 0 ? 26 : -26, -3);
      await sleep(40);
      await senseLook(turn > 0 ? 14 : -14, 0);
      // fire only on a real hit (not 1hp fall / tick noise)
      if (hpDropFast >= 8) {
        await agentInput("fire", {});
        await agentInput("fire", {});
      }
      setActionStatus(tick, "ACKNOWLEDGED", { ok: true });
      setActionStatus(tick, "VERIFIED", { detail: "fast-dmg" });
      ctx.lastHp = gsiQuick.health;
      ctx.lastArmor = gsiQuick.armor;
      finishTick(tick, { fast: "react-damage", dmg: hpDropFast });
      return { state: "RUNNING", ctx };
    }

    if (gsiQuick && gsiQuick.map && !gsiQuick.over && (gsiQuick.alive || gsiQuick.mapPhase === "live" || gsiQuick.phase === "live")) {
      if (String(gsiQuick.activity || "") === "textinput") {
        const nowChat = Date.now();
        if (!ctx.closeChatAt || nowChat - ctx.closeChatAt > 1500) {
          ctx.closeChatAt = nowChat;
          log("close chat, skip keys");
          await tapVk(VK.ESC);
        }
        finishTick(tick, { skip: "textinput" });
        return { state: "RUNNING", ctx };
      }
      const clockInfo = tickClock(gsiQuick, clockMem);
      gsiQuick.clock = clockInfo.clock;
      gsiQuick.dm = Boolean(clockInfo.dm || isDeathmatch(gsiQuick));
      writeSelf(gsiQuick);
      const freeze =
        !gsiQuick.dm &&
        (clockInfo.clock === "freeze" || gsiQuick.phase === "freezetime" || gsiQuick.mapPhase === "freezetime");
      const buyKey = gsiQuick.dm
        ? `dm:${gsiQuick.deaths}|${gsiQuick.team}`
        : `${gsiQuick.round}|${gsiQuick.team}`;
      const needBuy =
        freeze &&
        ctx.boughtRound !== buyKey &&
        gsiQuick.alive &&
        !alreadyArmed(gsiQuick);
      if (gsiQuick.alive && (gsiQuick.holdingC4 || /knife/i.test(String(gsiQuick.weaponType || gsiQuick.weapon || "")))) {
        if (Date.now() - (ctx.lastGun1 || 0) > 1800) {
          ctx.lastGun1 = Date.now();
          log("slot1 (was " + (gsiQuick.weapon || gsiQuick.weaponType) + ")");
          await tapVk(VK.N1);
        }
      }
      const seq = needBuy ? buyMenuSeq(gsiQuick) : [];
      const keys = seq.flat();
      if (seq.length) {
        log(`buy ${seq.map((s) => "b " + s.join(" ")).join("; ")} money=${gsiQuick.money}`);
        createAction(tick, { action: "KEY", reason: "buy-menu", key: "B" });
        setActionStatus(tick, "DISPATCHED");
        await buyFromMenu(gsiQuick);
        ctx.boughtRound = buyKey;
        setActionStatus(tick, "VERIFIED", { detail: "buy-menu" });
        finishTick(tick, { state: "RUNNING", phase: "IN_GAME", buy: keys.join("") });
        return { state: "RUNNING", ctx };
      }
      let ammoDrop = 0;
      if (typeof ctx.lastAmmo === "number" && gsiQuick.alive) {
        ammoDrop = Math.max(0, ctx.lastAmmo - Number(gsiQuick.ammo || 0));
      }
      if (clockInfo.clock === "execute") ammoDrop = 0;
      const pool = livePool(gsiQuick, { ammoDrop, clock: clockInfo.clock });
      const fromGsi = gsiRadar(gsiQuick, ctx.lastPos || null);
      const fy = yawFromForward(gsiQuick.forward);
      if (fy != null) ctx.viewYaw = fy;
      else if (fromGsi.facingOk) ctx.viewYaw = fromGsi.facing_deg;
      if (gsiQuick.pos) ctx.lastPos = gsiQuick.pos;
      const hostVis = await pullGuestVision();
      const health = captureHealthFromVision(hostVis, 0);
      markCapture(tick, {
        frame_id: tick.tick_id,
        timestamp_ms: Date.now(),
        valid: health.valid,
        latency_ms: health.transfer_ms,
        age_ms: health.age_ms,
        frame_hash: health.frame_hash,
        black_ratio: health.black_ratio,
        mean: health.mean,
        error: health.error
      });
      let cvFrame = null;
      if (hostVis.ok && health.valid && !health.repeated) {
        const ran = runCv();
        cvFrame = ran.frame;
        if (cvFrame?.ok) ctx.lastCv = cvFrame;
      }
      if (!cvFrame?.ok && ctx.lastCv?.ok) cvFrame = ctx.lastCv;
      if (!health.valid && !cvFrame?.ok) {
        if (gsiQuick.spectating || !gsiQuick.alive) await releaseAllKeys();
        createAction(tick, { action: "WAIT", reason: "capture-or-cv-bad" });
        setActionStatus(tick, "FAILED", { error: health.error || "stale-or-cv" });
        finishTick(tick, { capture_health: health, skipped: true });
        return { state: "RUNNING", ctx };
      }
      if (!cvFrame?.ok) {
        cvFrame = {
          ok: true,
          screen: "IN_GAME",
          confidence: 0.5,
          mean: health.mean || ctx.lastMean || 40,
          radar: fromGsi.ok ? fromGsi : { ok: false, wall_ahead: false, enemies: [], enemy_count: 0, allies: [] },
          yolo: { ok: false, dets: [] }
        };
      }
      const self = cvFrame?.radar?.self || cvFrame?.observations?.radar?.self || {};
      const zone = radarZone(gsiQuick.map, gsiQuick.team, self.nx, self.ny);
      gsiQuick.zone = zone;
      gsiQuick.leftSpawn = leftSpawn(zone, gsiQuick.team);
      gsiQuick.atSite = atSite(zone);
      gsiQuick.elapsedMs = clockInfo.elapsedMs;
      gsiQuick.clock = clockInfo.clock;
      gsiQuick.wallAhead = Boolean(cvFrame?.radar?.wall_ahead);
      gsiQuick.nx = Number(self.nx);
      gsiQuick.ny = Number(self.ny);
      const vis = {
        radar: {
          wall_ahead: Boolean(cvFrame?.radar?.wall_ahead),
          enemy_count: Number(cvFrame?.radar?.enemy_count || fromGsi.enemy_count || 0)
        }
      };
      const key = stateKey(gsiQuick, vis);
      const seen = Object.values(weights[key] || {}).reduce((s, c) => s + (c?.n || 0), 0);
      const stack = readStack();
      const obsWalk = packObservation({
        tickId: tick.tick_id,
        episodeId,
        capture: health,
        frame: cvFrame,
        gsi: gsiQuick,
        gsiAgeMs,
        clock: clockInfo.clock
      });
      const picked = choosePrefer({
        stack,
        prompt: stack.prompt !== false ? preferByPrompt() : null,
        rules: stack.rules !== false ? preferByRules(gsiQuick) : null,
        weights,
        key,
        explore: exploreRate(seen),
        allow: pool,
        bcPredict: bcPredictFn(),
        obs: obsWalk
      });
      const prefer = picked.action;
      writePolicyLive(picked);
      pending = { key, action: prefer };
      if (gsiQuick.dm) {
        ctx.route = { name: "dm", points: [], steps: [] };
        ctx.routeRound = gsiQuick.round;
        ctx.routeTeam = gsiQuick.team;
        ctx.routeI = 0;
      } else if (
        ctx.routeRound !== gsiQuick.round ||
        ctx.routeTeam !== gsiQuick.team ||
        !ctx.route
      ) {
        ctx.route = pickRoute(gsiQuick);
        ctx.routeRound = gsiQuick.round;
        ctx.routeTeam = gsiQuick.team;
        ctx.routeI = 0;
        ctx.routeLeft = Number(ctx.route?.steps?.[0]?.walk || 0);
        ctx.routeLookAt = -1;
        ctx.wSince = Date.now();
        ctx.lastNx = null;
        ctx.lastNy = null;
      }
      let routeStep = null;
      const walkPref =
        gsiQuick.leftSpawn === false ||
        clockInfo.clock === "execute" ||
        clockInfo.clock === "planted" ||
        ["explore", "strafe-advance", "radar-open", "unstick-wall", "plant", "defuse"].includes(prefer);
      const facing = Number(
        cvFrame?.radar?.facing_deg ?? cvFrame?.observations?.radar?.facing_deg ?? 0
      );
      const selfOk =
        Number.isFinite(self.nx) &&
        Number.isFinite(self.ny) &&
        !(self.nx < 0.05 && self.ny < 0.05);
      const wp = walkPref && selfOk ? steerWaypoint(ctx.route, ctx.routeI, self, facing) : null;
      if (wp) {
        ctx.routeI = wp.i;
        const now = Date.now();
        const moved =
          ctx.lastNx != null &&
          Number.isFinite(self.nx) &&
          Math.hypot(self.nx - ctx.lastNx, self.ny - ctx.lastNy) > 0.012;
        const stuckWp = Boolean(ctx.wSince && now - ctx.wSince > 2800 && !moved);
        routeStep = {
          ...wp,
          unstick: stuckWp,
          unstickTurn: wp.rel >= 0 ? 28 : -28,
          wallAhead: Boolean(cvFrame?.radar?.wall_ahead)
        };
        if (moved || !ctx.wSince) ctx.wSince = now;
        if (Number.isFinite(self.nx)) {
          ctx.lastNx = self.nx;
          ctx.lastNy = self.ny;
        }
      } else if (walkPref) {
        routeStep = {
          turn: 0,
          look: 0,
          ms: 420,
          turnOnce: false,
          unstick: false,
          nav: "walk"
        };
      }
      gsiQuick.navDist = Number(routeStep?.dist);
      const scored = rewards.step(gsiQuick);
      const obs = packObservation({
        tickId: tick.tick_id,
        episodeId,
        capture: health,
        frame: cvFrame,
        gsi: gsiQuick,
        gsiAgeMs,
        clock: clockInfo.clock
      });
      markObservation(tick, obs, null);
      const act = obsActionable(obs);
      if (!act.ok && (act.reason === "dead" || act.reason === "spectate" || act.reason === "menu")) {
        await releaseAllKeys();
        createAction(tick, { action: "WAIT", reason: act.reason });
        setActionStatus(tick, "FAILED", { error: act.reason });
        finishTick(tick, { obs_gate: act.reason });
        return { state: "RUNNING", ctx };
      }
      maybeLearn(pending.key, pending.action, scored);
      if (scored.learn && pending && Date.now() - lastSave > 8000 && !lockNow().freeze) {
        saveWeights(weights);
        lastSave = Date.now();
      }
      const fake = { ...cvFrame, screen: cvFrame.screen || "IN_GAME", age_ms: health?.age_ms };
      const hier = skillRun(fake, gsiQuick, 0);
      const decision = hier
        ? hier.decision
        : decide("RUNNING", fake, {
        stuckMs: 0,
        wallHits: 0,
        noProgress: 0,
        hpDrop: 0,
        playStep: ctx.playStep || 0,
        lastScreen: "IN_GAME",
        lastMean: fake.mean,
        gsi: gsiQuick,
        gsiForGate: gsiQuick,
        prefer,
        prompt: readLivePrompt(),
        intent: readLiveIntent(),
        stack,
        routeStep,
        routeName: ctx.route?.name || "",
        clock: clockInfo.clock,
        viewYaw: ctx.viewYaw,
        viewPitch: ctx.viewPitch
      });
      if (hier) {
        writePolicyLive({ source: "skill-" + hier.skill, action: hier.skill, ok: true });
        prefer = hier.skill;
      }
      pending.action = reasonToAction(decision.reason || prefer || "explore");
      if (decision.reason === "site-unstick" && !lockNow().freeze) learn(weights, pending.key, pending.action, -0.35);
      createAction(tick, decision);
      if (tick.tick_id <= 3 && rawQuick) {
        log("gsi root " + Object.keys(rawQuick).join(","));
        log("gsi player fields " + Object.keys(rawQuick.player || {}).join(","));
      }
      const nx = Number.isFinite(self.nx) ? self.nx.toFixed(2) : "-";
      const ny = Number.isFinite(self.ny) ? self.ny.toFixed(2) : "-";
      const dist = Number.isFinite(routeStep?.dist) ? routeStep.dist.toFixed(2) : "-";
      log(
        `tick=${tick.tick_id} gsi-live ${clockInfo.clock} ${gsiQuick.team || "-"} hp=${gsiQuick.health} ${gsiQuick.map} bomb=${gsiQuick.bombState || gsiQuick.bomb || "-"} zone=${zone} nx=${nx} ny=${ny} nav=${routeStep?.nav || "-"} dist=${dist} eyes=${hostVis.ok ? (hostVis.src || "guest") : "blind"} mean=${hostVis.mean ?? "-"} route=${ctx.route?.name || "-"} -> ${decision.reason}`
      );
      const stuckBits = [];
      if (!gsiQuick.alive) stuckBits.push("dead-or-menu");
      if (!hostVis.ok) stuckBits.push("eyes-blind");
      if (Number(hostVis.mean) > 200) stuckBits.push("screen-white");
      if (Number(hostVis.mean) < 8) stuckBits.push("screen-black");
      if (!Number.isFinite(self.nx)) stuckBits.push("no-radar-self");
      if (String(zone).includes("spawn")) stuckBits.push("still-on-spawn");
      if (gsiQuick.wallAhead) stuckBits.push("wall-ahead");
      if (gsiQuick.holdingC4) stuckBits.push("holding-c4");
      if (clockInfo.clock === "freeze") stuckBits.push("freeze");
      const foesN = Number(cvFrame?.radar?.enemy_count || fromGsi.enemy_count || 0);
      think({
        tick: tick.tick_id,
        see: `map=${gsiQuick.map} clock=${clockInfo.clock} team=${gsiQuick.team || "-"} hp=${gsiQuick.health} alive=${gsiQuick.alive} gun=${gsiQuick.weapon || "-"} zone=${zone} nx=${nx} ny=${ny} wall=${Boolean(gsiQuick.wallAhead)} foes=${foesN} eyes=${hostVis.ok ? (hostVis.src || "guest") : "blind"} mean=${hostVis.mean ?? "-"}`,
        why: stuckBits.length ? stuckBits.join(",") : "ok-push-site",
        do: `${decision.reason || "-"} keepW=${Boolean(decision.keepW)} nav=${routeStep?.nav || "-"} dist=${dist} route=${ctx.route?.name || "-"} prefer=${prefer || "-"} policy=${picked.source || "-"} prompt=${(readLivePrompt() || "-").slice(0, 80)}`,
        stuck: stuckBits
      });
      setActionStatus(tick, "DISPATCHED");
      const applied = await applyDecision(decision, { ...ctx, gsi: gsiQuick, gsiForGate: gsiQuick });
      if (decision.keepW) ctx.wHeld = true;
      else if (ctx.wHeld) {
        await agentInput("keyup", { vk: VK.W });
        ctx.wHeld = false;
      }
      if (gsiQuick.spectating || !gsiQuick.alive) {
        await releaseAllKeys();
        ctx.wHeld = false;
      }
      setActionStatus(tick, applied.acked ? "ACKNOWLEDGED" : "FAILED", {
        ok: applied.acked,
        error: applied.acked ? null : "input-nack"
      });
      if (applied.acked) setActionStatus(tick, "VERIFIED", { detail: "gsi-live" });
      ctx.lastHp = Number(gsiQuick.health || 0);
      ctx.lastArmor = Number(gsiQuick.armor || 0);
      ctx.lastAmmo = Number(gsiQuick.ammo || 0);
      ctx.lastPos = gsiQuick.pos || ctx.lastPos || null;
      ctx.lastScreen = "IN_GAME";
      ctx.stuckMs = 0;
      ctx.wallHits = 0;
      ctx.noProgress = 0;
      finishTick(tick, { state: "RUNNING", phase: "IN_GAME", gsiLive: true });
      return { state: "RUNNING", ctx };
    }

    const tCap = Date.now();
    const vision = await pullGuestVision();
    const transferMs = Date.now() - tCap;
    const health = captureHealthFromVision(vision, transferMs);
    markCapture(tick, {
      frame_id: tick.tick_id,
      timestamp_ms: Date.now(),
      valid: health.valid,
      latency_ms: transferMs,
      transfer_ms: transferMs,
      age_ms: health.age_ms,
      frame_hash: health.frame_hash,
      black_ratio: health.black_ratio,
      mean: health.mean,
      error: health.error
    });

    if (!health.valid || health.repeated) {
      log(`tick=${tick.tick_id} capture-bad mean=${health.mean} err=${health.error} rep=${health.repeated}`);
      const gBad = gsi.snapshot() ? parseGsi(gsi.snapshot()) : null;
      think({
        tick: tick.tick_id,
        see: `capture-bad mean=${health.mean} err=${health.error} gsi=${gBad ? `${gBad.map} alive=${gBad.alive} act=${gBad.activity}` : "none"}`,
        why: "eyes-fail",
        do: "wait",
        stuck: ["eyes-fail"]
      });
      createAction(tick, { action: "WAIT", reason: "capture-bad" });
      setActionStatus(tick, "FAILED", { error: "capture-bad" });
      finishTick(tick, { capture_health: health });
      return { state: "STARTING", ctx: { ...ctx, stuckMs: (ctx.stuckMs || 0) + 1500 } };
    }

    const { frame, ms: cvMs } = runCv();
    if (!frame?.ok) {
      createAction(tick, { action: "WAIT", reason: "cv-fail" });
      setActionStatus(tick, "FAILED", { error: "cv-fail" });
      finishTick(tick, {});
      return { state: "STARTING", ctx: { ...ctx, stuckMs: (ctx.stuckMs || 0) + 1500 } };
    }

    const raw = gsi.snapshot();
    const gsiState = raw ? parseGsi(raw) : null;
    const gsiAgeSlow = gsi.receivedAt ? Date.now() - (gsi.receivedAt() || 0) : null;
    const obsSlow = packObservation({
      tickId: tick.tick_id,
      episodeId,
      capture: health,
      frame,
      gsi: gsiState,
      gsiAgeMs: gsiAgeSlow,
      clock: gsiState ? tickClock(gsiState, clockMem).clock : ""
    });
    markObservation(tick, obsSlow, cvMs);
    if (gsiState && gsiState.alive && !gsiState.spectating && !gsiState.inMenu) {
      const actSlow = obsActionable(obsSlow);
      if (!actSlow.ok) {
        if (actSlow.reason === "dead" || actSlow.reason === "spectate" || actSlow.reason === "menu") {
          await releaseAllKeys();
        }
        createAction(tick, { action: "WAIT", reason: actSlow.reason });
        setActionStatus(tick, "FAILED", { error: actSlow.reason });
        finishTick(tick, { obs_gate: actSlow.reason });
        return { state, ctx };
      }
    }
    let hpDrop = 0;
    if (gsiState && typeof ctx.lastHp === "number" && gsiState.alive) {
      hpDrop = Math.max(0, ctx.lastHp - Number(gsiState.health || 0));
      // armor chip also counts as "got shot"
      if (typeof ctx.lastArmor === "number") {
        hpDrop += Math.max(0, Math.floor((ctx.lastArmor - Number(gsiState.armor || 0)) / 2));
      }
    }
    const stackNow = readStack();
    if (gsiState) {
      writeSelf(gsiState);
      const scored = rewards.step(gsiState);
      maybeLearn(pending?.key, pending?.action, scored);
      if (scored.learn && pending?.key && Date.now() - lastSave > 6000 && !lockNow().freeze) {
        saveWeights(weights);
        lastSave = Date.now();
      }
      if (scored.learn && scored.reward && !lockNow().freeze) log(`reward ${scored.reward.toFixed(2)} ${scored.events.join(",")} tick=${tick.tick_id}`);
    }

    let stuckMs = ctx.stuckMs || 0;
    let wallHits = ctx.wallHits || 0;
    let noProgress = ctx.noProgress || 0;
    const meanDelta = Math.abs((frame.mean || 0) - (ctx.lastMean ?? frame.mean ?? 0));
    const hash = frame.capture_health?.frame_hash || frame.observations?.capture?.frame_hash || null;
    const sameHash = Boolean(hash && hash === ctx.lastHash);
    const wallEst = Boolean(frame.estimates?.radar?.wall_ahead || frame.radar?.wall_ahead);
    const lastPushed = Boolean(ctx.lastPushedForward);
    // held W but view barely changed => stuck on wall
    if ((frame.screen === "IN_GAME" || (gsiState && gsiState.alive)) && lastPushed && (meanDelta < 2.2 || sameHash)) {
      noProgress += 1;
      stuckMs += 900;
      wallHits += 1;
    } else if (frame.screen === "IN_GAME" || (gsiState && gsiState.alive)) {
      if (wallEst) {
        stuckMs += 600;
        if (meanDelta < 1.5) wallHits += 1;
      } else if (meanDelta < 0.7) {
        stuckMs += 450;
        noProgress += 1;
      } else {
        stuckMs = Math.max(0, stuckMs - 800);
        wallHits = Math.max(0, wallHits - 1);
        noProgress = Math.max(0, noProgress - 1);
      }
    } else if (frame.screen === ctx.lastScreen) stuckMs += 500;
    else {
      stuckMs = 0;
      wallHits = 0;
      noProgress = 0;
    }

    let prefer = stackNow.prompt !== false ? preferByPrompt() : null;
    const tDec = Date.now();
    if (gsiState && gsiState.alive && !gsiState.inMenu) {
      const key = stateKey(gsiState, frame);
      const seen = Object.values(weights[key] || {}).reduce((s, c) => s + (c?.n || 0), 0);
      const picked = choosePrefer({
        stack: stackNow,
        prompt: stackNow.prompt !== false ? preferByPrompt() : null,
        rules: stackNow.rules !== false ? preferByRules(gsiState) : null,
        weights,
        key,
        explore: exploreRate(seen),
        allow: livePool(gsiState, { clock: tickClock(gsiState, clockMem).clock }),
        bcPredict: bcPredictFn(),
        obs: obsSlow
      });
      writePolicyLive(picked);
      pending = { key, action: picked.action };
      prefer = picked.action;
      ctx.policySource = picked.source;
      ctx.policyOk = picked.ok;
    }

    const hierSlow = skillRun({ ...frame, age_ms: health?.age_ms }, gsiState, stuckMs);
    const decision = hierSlow
      ? hierSlow.decision
      : decide(state, frame, {
      stuckMs,
      wallHits,
      noProgress,
      hpDrop,
      playStep: ctx.playStep || 0,
      lastScreen: ctx.lastScreen,
      lastMean: ctx.lastMean,
      gsi: gsiState,
      prefer,
      prompt: readLivePrompt(),
      intent: readLiveIntent(),
      stack: stackNow,
      viewYaw: ctx.viewYaw,
      viewPitch: ctx.viewPitch
    });
    if (hierSlow) {
      writePolicyLive({ source: "skill-" + hierSlow.skill, action: hierSlow.skill, ok: true });
      ctx.policySource = "skill-" + hierSlow.skill;
    }
    markLatency(tick, "decision_ms", Date.now() - tDec);
    markConfirmed(tick, decision.confirmed);
    pending.action = reasonToAction(decision.reason || prefer || "explore");
    createAction(tick, decision);

    const rad = frame.radar?.ok
      ? `self=${frame.radar.self ? "blue" : "?"} face=${frame.radar.facing_deg}(${frame.observations?.radar?.facing_from || "?"}) foes=${frame.radar.enemy_count} wall=${frame.radar.wall_ahead} openRel=${frame.radar.open_best?.rel} mov=${frame.estimates?.motion?.count || 0} stuckN=${noProgress}`
      : "off";
    const gsiNote = gsiState
      ? `hp=${gsiState.health} ammo=${gsiState.ammo} alive=${gsiState.alive}${hpDrop ? ` dmg=${hpDrop}` : ""}`
      : "off";
    const conf = decision.confirmed;
    log(
      `tick=${tick.tick_id} phase=${conf?.phase} play=${conf?.gameplay_allowed} conflict=${conf?.conflict || "-"} ` +
        `cv=${frame.screen} dMean=${meanDelta.toFixed(1)} stuck=${stuckMs} policy=${ctx.policySource || "fsm"} -> ${decision.fsm}/${decision.action} ${decision.reason} | ${gsiNote} | radar ${rad}`
    );

    setActionStatus(tick, "DISPATCHED");
    const tIn = Date.now();
    const applied = await applyDecision(decision, { ...ctx, gsi: gsiState, gsiForGate: gsiState });
    markLatency(tick, "input_ms", Date.now() - tIn);
    setActionStatus(tick, applied.acked ? "ACKNOWLEDGED" : "FAILED", {
      ok: applied.acked,
      error: applied.acked ? null : "input-nack"
    });

    if (decision.nextPlayStep != null) ctx.playStep = decision.nextPlayStep;
    const pushedForward = decisionHasForward(decision);
    if (decision.clearWall && !pushedForward) {
      stuckMs = Math.max(0, stuckMs - 400);
      wallHits = Math.max(1, wallHits);
    }

    const tVer = Date.now();
    let after = frame;
    let verifyMd = meanDelta;
    if (decision.action === "CLICK" || decision.expect?.kind === "screen_change" || decision.expect?.kind === "screen_in") {
      await pullGuestVision();
      const cv2 = runCv();
      after = cv2.frame || frame;
      verifyMd = after ? Math.abs((after.mean || 0) - (frame.mean || 0)) : 0;
      markLatency(tick, "cv_ms", (tick.latency.cv_ms || 0) + (cv2.ms || 0));
    } else if (decision.expect?.kind === "motion") {
      verifyMd = meanDelta;
    }
    markLatency(tick, "verify_ms", Date.now() - tVer);

    const verified = verifyExpect(decision.expect, frame, after, verifyMd);
    if (tick.action?.status === "ACKNOWLEDGED") {
      if (verified.ok) setActionStatus(tick, "VERIFIED", { detail: verified.detail });
      else setActionStatus(tick, "FAILED", { error: "verify-failed", detail: verified.detail });
    }

    if (decision.action === "CLICK") {
      log(`verify tick=${tick.tick_id} ${verified.detail} status=${tick.action?.status}`);
      if (!verified.ok && verifyMd < 3) stuckMs += 2000;
      else if (verified.ok) stuckMs = 0;
    }

    state = nextState(state, after || frame, decision, decision.confirmed);
    ctx.lastScreen = after?.screen || frame.screen;
    ctx.lastMean = after?.mean ?? frame.mean;
    ctx.lastHash = hash;
    ctx.lastPushedForward = pushedForward;
    ctx.stuckMs = stuckMs;
    ctx.wallHits = wallHits;
    ctx.noProgress = noProgress;
    if (gsiState) {
      ctx.lastHp = Number(gsiState.health || 0);
      ctx.lastArmor = Number(gsiState.armor || 0);
    }

    finishTick(tick, {
      state,
      phase: conf?.phase,
      action_status: tick.action?.status,
      capture_errors_total: captureErrors
    });

    writeFileSync(
      path.join(VISION, "fsm-state.json"),
      JSON.stringify(
        {
          state,
          confirmed: conf,
          ctx,
          pending,
          tick_id: tick.tick_id,
          action: tick.action?.status,
          latency: latencySnapshot(),
          at: new Date().toISOString()
        },
        null,
        2
      )
    );
    return { state, ctx };
  } finally {
    busy = false;
  }
}

async function main() {
  if (!existsSync(PY)) {
    console.error("python missing", PY);
    process.exit(1);
  }
  log(`fsm protocol start gsi:${gsiPort} episode + tick journal cv-worker`);
  ensureCvWorker();
  let state = "STARTING";
  let ctx = {
    stuckMs: 0,
    playStep: 0,
    lastScreen: "",
    lastMean: 0,
    wallHits: 0,
    noProgress: 0,
    lastPushedForward: false,
    lastHash: null,
    lastHp: null,
    lastArmor: null,
    viewYaw: 0,
    viewPitch: 0
  };
  while (true) {
    try {
      const r = await cycle(state, ctx);
      state = r.state;
      ctx = r.ctx;
      await sleep(state === "RUNNING" ? 60 : 250);
    } catch (e) {
      log(`err ${e.message}`);
      state = "STARTING";
      await sleep(1500);
    }
  }
}

main();
process.on("exit", () => saveLatency());
process.on("SIGINT", () => {
  saveLatency();
  releaseAllKeys().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  saveLatency();
  releaseAllKeys().finally(() => process.exit(0));
});
