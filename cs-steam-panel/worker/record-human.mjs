// record-human: dense nn dataset while you play. does not drive the game.
import { spawnSync } from "child_process";
import {
  appendFileSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  copyFileSync,
  unlinkSync
} from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { startGsi, parseGsi } from "./gsi.mjs";
import { sleep } from "./pace.mjs";
import { tickClock } from "./round-clock.mjs";
import { makeTrajStep } from "./dataset-traj.mjs";
import { packObservation } from "./obs.mjs";
import { actionFromKeys, keysWithMouse } from "./keys-action.mjs";
import { createHash } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.FARM_HUMAN_DIR || "D:/FarmVMs/ops/vision/human-record";
const LIVE = path.join(path.dirname(OUT), "live.png");
const RADAR_CROP = path.join(path.dirname(OUT), "radar-crop.png");
const RADAR_PATHS = path.join(path.dirname(OUT), "radar-paths.png");
const STOP_ROOT = path.join(OUT, "stop.flag");
const STATUS = path.join(OUT, "status.json");
const PY = process.env.FARM_PYTHON || "C:/Users/R00/AppData/Local/Programs/Python/Python312/python.exe";
const ENGINE = path.join(__dirname, "cv", "engine.py");
const ip = process.env.FARM_GOLDEN_IP || "10.250.0.10";
const agentToken = process.env.FARM_AGENT_TOKEN || "csfarm";
const agentPort = Number(process.env.FARM_AGENT_PORT || 39200);
const gsiPort = Number(process.env.BOT_GSI_PORT || 32222);
const DURATION_MS = Number(process.env.FARM_RECORD_MS || 30 * 60 * 1000);
const FRAME_EVERY_MS = Number(process.env.FARM_RECORD_FRAME_MS || 800);
const KEY_EVERY_MS = Number(process.env.FARM_RECORD_KEY_MS || 50);
const WANT_CV = process.env.FARM_RECORD_CV !== "0";

const sessionBase = `human-${Date.now().toString(36)}`;
let episodeN = 0;
function episodeId() {
  return episodeN ? sessionBase + "-e" + episodeN : sessionBase;
}
const sessionId = episodeId();
const sessDir = path.join(OUT, sessionId);
const framesDir = path.join(sessDir, "frames");
const radarDir = path.join(sessDir, "radar");
mkdirSync(framesDir, { recursive: true });
mkdirSync(radarDir, { recursive: true });
try {
  unlinkSync(path.join(sessDir, "stop.flag"));
} catch {}
try {
  unlinkSync(STOP_ROOT);
} catch {}

const metaPath = path.join(sessDir, "meta.json");
const schemaPath = path.join(sessDir, "schema.json");
const gsiPath = path.join(sessDir, "gsi.jsonl");
const keysPath = path.join(sessDir, "keys.jsonl");
const ticksPath = path.join(sessDir, "ticks.jsonl");
const samplesPath = path.join(sessDir, "samples.jsonl");
const trajPath = path.join(sessDir, "traj.jsonl");
const framesPath = path.join(sessDir, "frames.jsonl");
const eventsPath = path.join(sessDir, "events.jsonl");
const logPath = path.join(sessDir, "record.log");

const tMono0 = process.hrtime.bigint();
function monoMs() {
  return Number((process.hrtime.bigint() - tMono0) / 1000000n);
}

function log(line) {
  const s = `${new Date().toISOString()} ${line}`;
  console.log(s);
  try {
    appendFileSync(logPath, s + "\n");
  } catch {}
}

async function agent(route, opts = {}) {
  try {
    const r = await fetch(`http://${ip}:${agentPort}${route}`, {
      method: opts.method || "GET",
      headers: {
        authorization: `Bearer ${agentToken}`,
        ...(opts.body ? { "content-type": "application/json" } : {})
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs || 12000)
    });
    if (opts.binary) return Buffer.from(await r.arrayBuffer());
    return await r.json().catch(() => null);
  } catch {
    return null;
  }
}

function appendJsonl(file, obj) {
  appendFileSync(file, JSON.stringify(obj) + "\n");
}

function gsiSnap(p) {
  if (!p) return null;
  return {
    map: p.map,
    mapPhase: p.mapPhase,
    round: p.round,
    phase: p.phase,
    bomb: p.bomb,
    bombState: p.bombState,
    bombPos: p.bombPos,
    bombCountdown: p.bombCountdown,
    team: p.team,
    health: p.health,
    armor: p.armor,
    money: p.money,
    spectating: p.spectating,
    alive: p.alive,
    activity: p.activity,
    weapon: p.weapon,
    weaponType: p.weaponType,
    ammo: p.ammo,
    ammoReserve: p.ammoReserve,
    ammoMax: p.ammoMax,
    loadout: p.loadout,
    helmet: p.helmet,
    kit: p.kit,
    hasC4: p.hasC4,
    hasRifle: p.hasRifle,
    hasStarGun: p.hasStarGun,
    holdingC4: p.holdingC4,
    flashed: p.flashed,
    smoked: p.smoked,
    burning: p.burning,
    flashes: p.flashes,
    smokes: p.smokes,
    hes: p.hes,
    molly: p.molly,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    score: p.score,
    pos: p.pos,
    forward: p.forward,
    foeN: Array.isArray(p.foes) ? p.foes.length : 0,
    allyN: Array.isArray(p.allies) ? p.allies.length : 0,
    foes: Array.isArray(p.foes) ? p.foes.slice(0, 8) : [],
    allies: Array.isArray(p.allies) ? p.allies.slice(0, 8) : [],
    armed: alreadyArmed(p),
    buySeq: buyMenuSeq(p)
  };
}

function radarSlim(frame) {
  const r = frame?.radar;
  if (!r) return null;
  return {
    ok: r.ok,
    facing: r.facing_deg,
    wall: r.wall_ahead,
    foes: r.enemy_count,
    allies: r.ally_count,
    nx: r.self?.nx,
    ny: r.self?.ny,
    openRel: r.open_best?.rel,
    free: frame?.estimates?.radar?.path_free_fwd
  };
}

function yoloSlim(frame) {
  const dets = Array.isArray(frame?.yolo?.dets) ? frame.yolo.dets : [];
  return dets.slice(0, 32).map((d) => ({
    cls: d.cls ?? d.class ?? d.name,
    conf: d.conf ?? d.p,
    x: d.x ?? d.cx,
    y: d.y ?? d.cy,
    w: d.w,
    h: d.h
  }));
}

writeFileSync(
  schemaPath,
  JSON.stringify(
    {
      ticks: "50ms row: t, keys, action, gsi, clock, timing",
      gsi: "every gsi packet: parsed snap",
      keys: "raw guest GetAsyncKeyState",
      frames: "png + engine json + radar copy",
      samples: "one nn row per screenshot: image, radar, keys, action, gsi, yolo, radar_cv, screen, clock",
      events: "fire rising-edge, death, spectate, plant, kill"
    },
    null,
    2
  )
);

const SCHEMA_NOTE = {
  sessionId,
  startedAt: new Date().toISOString(),
  durationMs: DURATION_MS,
  frameEveryMs: FRAME_EVERY_MS,
  keyEveryMs: KEY_EVERY_MS,
  cv: WANT_CV,
  split: ["ticks.jsonl", "gsi.jsonl", "keys.jsonl", "frames.jsonl", "samples.jsonl", "traj.jsonl", "events.jsonl", "frames/", "radar/"],
  note: "human play; bot stopped; dense gsi+keys+yolo+radar; no sendinput"
};
writeFileSync(metaPath, JSON.stringify(SCHEMA_NOTE, null, 2));

let gsiCount = 0;
let keyCount = 0;
let frameCount = 0;
let fireCount = 0;
let tickCount = 0;
let sampleCount = 0;
let lastGsi = null;
let lastKeys = {};
let lastKeysAt = 0;
let lastM1 = false;
let lastAlive = null;
let lastSpec = null;
let lastBomb = "";
let lastKills = 0;
let stop = false;
let flushed = false;
const clockMem = {};

function counts() {
  return {
    gsi: gsiCount,
    keys: keyCount,
    frames: frameCount,
    fires: fireCount,
    ticks: tickCount,
    samples: sampleCount
  };
}

function writeStatus(extra = {}) {
  const body = {
    on: !stop,
    starting: false,
    flushed,
    session: sessionId,
    pid: process.pid,
    ...counts(),
    at: new Date().toISOString(),
    ...extra
  };
  try {
    writeFileSync(path.join(sessDir, "status.json"), JSON.stringify(body, null, 2));
    mkdirSync(OUT, { recursive: true });
    writeFileSync(STATUS, JSON.stringify(body, null, 2));
  } catch {}
}

function wantStop() {
  return existsSync(STOP_ROOT) || existsSync(path.join(sessDir, "stop.flag"));
}

function emitEvent(kind, extra) {
  appendJsonl(eventsPath, { t: Date.now(), kind, keys: lastKeys, gsi: lastGsi?.snap || null, ...extra });
}

const gsi = startGsi({
  port: gsiPort,
  token: process.env.BOT_GSI_TOKEN || "csfarm",
  onState: (raw) => {
    const t = Date.now();
    const parsed = parseGsi(raw);
    const snap = gsiSnap(parsed);
    const clk = tickClock(parsed, clockMem);
    lastGsi = { t, snap, clock: clk.clock, elapsedMs: clk.elapsedMs, planted: clk.planted };
    appendJsonl(gsiPath, { t, clock: clk.clock, elapsedMs: clk.elapsedMs, planted: clk.planted, ...snap });
    gsiCount += 1;
    if (lastAlive === true && snap.alive === false) {
      emitEvent("death");
      appendJsonl(
        trajPath,
        makeTrajStep({
          episodeId: episodeId(),
          t: Date.now(),
          observation: packObservation({
            tickId: frameCount,
            episodeId: episodeId(),
            capture: { valid: false, repeated: false, error: "death" },
            gsi: snap,
            clock: clk.clock
          }),
          action: "idle",
          keys: lastKeys,
          done: true,
          source: "human",
          terminal: "death",
          modelVersion: "none"
        })
      );
      episodeN += 1;
    }
    if (lastSpec === false && snap.spectating === true) emitEvent("spectate");
    if (lastBomb !== "planted" && (snap.bomb === "planted" || snap.bombState === "planted")) emitEvent("plant");
    if (Number(snap.kills) > lastKills) emitEvent("kill", { kills: snap.kills });
    lastAlive = snap.alive;
    lastSpec = snap.spectating;
    lastBomb = String(snap.bomb || snap.bombState || "");
    lastKills = Number(snap.kills || 0);
  }
});

async function sampleKeys() {
  const j = await agent("/keysample?token=" + encodeURIComponent(agentToken), { timeoutMs: 2000 });
  if (!j || !j.ok) return;
  const t = Date.now();
  const t_mono = monoMs();
  lastKeys = keysWithMouse(j.keys || {});
  lastKeysAt = t;
  const action = actionFromKeys(lastKeys);
  const clk = lastGsi ? { clock: lastGsi.clock, elapsedMs: lastGsi.elapsedMs, planted: lastGsi.planted } : null;
  appendJsonl(keysPath, { t, t_mono, keys: lastKeys, action, mouse: { dx: Number(lastKeys.dx || 0), dy: Number(lastKeys.dy || 0), m1: Boolean(lastKeys.M1), m2: Boolean(lastKeys.M2) }, source: "human" });
  appendJsonl(ticksPath, { t, keys: lastKeys, action, gsi: lastGsi?.snap || null, ...clk });
  keyCount += 1;
  tickCount += 1;
  const m1 = Boolean(lastKeys.M1);
  if (m1 && !lastM1) {
    fireCount += 1;
    emitEvent("fire");
    try {
      await sampleFrame("fire");
    } catch (e) {
      log("fire-frame-err " + (e.message || e));
    }
  }
  lastM1 = m1;
}

function copyRadar(stem) {
  const out = path.join(radarDir, stem + ".png");
  try {
    if (existsSync(RADAR_CROP)) copyFileSync(RADAR_CROP, out);
  } catch {}
  try {
    if (existsSync(RADAR_PATHS)) copyFileSync(RADAR_PATHS, path.join(radarDir, stem + "-paths.png"));
  } catch {}
  return existsSync(out) ? "radar/" + stem + ".png" : null;
}

async function sampleFrame(reason) {
  const seen = await agent("/see?token=" + encodeURIComponent(agentToken), {
    method: "POST",
    body: {},
    timeoutMs: 20000
  });
  const buf = await agent(`/shot?token=${encodeURIComponent(agentToken)}`, {
    binary: true,
    timeoutMs: 20000
  });
  if (!buf || !buf.length) return;
  writeStatus();
  const stem = `f-${String(frameCount).padStart(6, "0")}`;
  const name = stem + ".png";
  const fp = path.join(framesDir, name);
  writeFileSync(fp, buf);
  let frame = null;
  if (WANT_CV && existsSync(PY) && existsSync(ENGINE)) {
    const out = path.join(framesDir, stem + ".json");
    const r = spawnSync(PY, [ENGINE, "--image", fp, "--out", out], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 25000
    });
    if (r.status === 0 && existsSync(out)) {
      try {
        frame = JSON.parse(readFileSync(out, "utf8"));
      } catch {}
    }
  }
  const t = Date.now();
  const t_mono = monoMs();
  const hash = createHash("md5").update(buf).digest("hex").slice(0, 12);
  const radarFile = copyRadar(stem);
  const action = actionFromKeys(lastKeys);
  const yolo = yoloSlim(frame);
  const radar = radarSlim(frame);
  const skew_ms = lastKeysAt ? t - lastKeysAt : null;
  appendJsonl(framesPath, {
    t,
    t_mono,
    hash,
    keys_t: lastKeysAt || null,
    skew_ms,
    episode_id: episodeId(),
    reason: reason || "tick",
    file: "frames/" + name,
    radarFile,
    mean: seen?.mean ?? frame?.mean,
    screen: frame?.screen,
    yoloN: yolo.length,
    action,
    keys: lastKeys,
    gsi: lastGsi?.snap || null
  });
  appendJsonl(samplesPath, {
    t,
    image: "frames/" + name,
    radar: radarFile,
    action,
    keys: lastKeys,
    gsi: lastGsi?.snap || null,
    clock: lastGsi?.clock || null,
    elapsedMs: lastGsi?.elapsedMs || 0,
    planted: Boolean(lastGsi?.planted),
    yolo,
    radar_cv: radar,
    screen: frame?.screen || null,
    hud: frame?.hud || null
  });
  sampleCount += 1;
  appendJsonl(
    trajPath,
    makeTrajStep({
      episodeId: episodeId(),
      t,
      observationId: stem,
      observation: packObservation({
        tickId: frameCount,
        episodeId: episodeId(),
        capture: { valid: true, mean: seen?.mean ?? frame?.mean, age_ms: 0, frame_hash: hash, repeated: false },
        frame,
        gsi: lastGsi?.snap || null,
        gsiAgeMs: lastGsi ? Date.now() - lastGsi.t : null,
        clock: lastGsi?.clock
      }),
      action,
      keys: lastKeys,
      mouse: { dx: Number(lastKeys?.dx || 0), dy: Number(lastKeys?.dy || 0), m1: Boolean(lastKeys?.M1), m2: Boolean(lastKeys?.M2) },
      reward: 0,
      done: false,
      source: "human",
      sourceRole: "human",
      modelVersion: "none",
      actionDurationMs: FRAME_EVERY_MS
    })
  );
  if (reason === "fire") {
    try {
      copyFileSync(fp, LIVE);
    } catch {}
    log("fire " + name + " yolo=" + yolo.length + " action=" + action);
  }
  frameCount += 1;
}

function finish(t0) {
  stop = true;
  flushed = true;
  appendJsonl(
    trajPath,
    makeTrajStep({
      episodeId: episodeId(),
      t: Date.now(),
      observation: lastGsi
        ? packObservation({
            tickId: frameCount,
            episodeId: episodeId(),
            capture: { valid: false, repeated: false, error: "end" },
            gsi: lastGsi.snap,
            clock: lastGsi.clock
          })
        : null,
      action: "idle",
      keys: lastKeys,
      reward: 0,
      done: true,
      source: "human",
      terminal: "record-stop",
      modelVersion: "none"
    })
  );
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        ...SCHEMA_NOTE,
        endedAt: new Date().toISOString(),
        startedAt: new Date(t0).toISOString(),
        counts: counts()
      },
      null,
      2
    )
  );
  writeStatus({ on: false, flushed: true, ending: true });
  log(
    `record-human done gsi=${gsiCount} keys=${keyCount} frames=${frameCount} fires=${fireCount} ticks=${tickCount} samples=${sampleCount}`
  );
  try {
    gsi.server.close();
  } catch {}
}

async function main() {
  log(`record-human start ${sessionId} frame=${FRAME_EVERY_MS}ms key=${KEY_EVERY_MS}ms cv=${WANT_CV ? 1 : 0}`);
  log(`out ${sessDir}`);
  writeStatus();
  const t0 = Date.now();
  let lastFrame = 0;
  let lastKey = 0;
  let lastStatus = 0;

  while (!stop && Date.now() - t0 < DURATION_MS) {
    if (wantStop()) break;
    const now = Date.now();
    if (now - lastKey >= KEY_EVERY_MS) {
      lastKey = now;
      await sampleKeys();
    }
    if (now - lastFrame >= FRAME_EVERY_MS) {
      lastFrame = now;
      try {
        await sampleFrame("tick");
      } catch (e) {
        log(`frame-err ${e.message}`);
      }
    }
    if (now - lastStatus >= 2000) {
      lastStatus = now;
      writeStatus();
    }
    await sleep(15);
  }

  finish(t0);
  process.exit(0);
}

process.on("SIGTERM", () => {
  stop = true;
});
process.on("SIGINT", () => {
  stop = true;
});

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
