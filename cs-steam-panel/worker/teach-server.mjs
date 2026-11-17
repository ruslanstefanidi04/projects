// teach ui: you box players on live.png, write what to do. yolo labels + notes.
// farm.bat teach -> http://127.0.0.1:39210
import { createServer } from "http";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, appendFileSync, readdirSync, openSync, rmSync, statSync, unlinkSync } from "fs";
import { spawn, spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { FARM_ROOT } from "./vm/defaults.mjs";
import { parsePrompt, PROMPT_SAY } from "./play-policy.mjs";
import { readStack, writeStack, DEFAULT_STACK } from "./brain-cfg.mjs";
import { readLock, voteGrade } from "./grade.mjs";
import { POLICY_IDS, activePolicyId, setPolicyId, confirmPolicy, readActivate } from "./policy-router.mjs";
import { runDatasetQc } from "./dataset-qc.mjs";
import { brainAppend, brainTail, brainFiles } from "./brain-log.mjs";
import { readLab, writeLab, stopLab } from "./lab/state.mjs";
import { planWalk, facingDeg, selfOnRadar, fuseWalkFrame } from "./lab/walk-plan.mjs";
import { startWalkDrive, stopWalkDrive, walkDriveStatus, nudgeWalk } from "./lab/walk-drive.mjs";
import { startLabGsi } from "./lab/gsi-self.mjs";
import { readStages, patchStage } from "./lab/stages.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.FARM_TEACH_PORT || 39210);
const LIVE = path.join(FARM_ROOT, "ops", "vision", "live.png");
const VISION = path.join(FARM_ROOT, "ops", "vision");
const HTML = path.join(__dirname, "cv", "lab.html");
const HTML_LEGACY = path.join(__dirname, "cv", "teach.html");
const HTML_BRAIN = path.join(__dirname, "cv", "brain.html");
const HUMAN = path.join(FARM_ROOT, "ops", "yolo", "human");
const IMAGES = path.join(HUMAN, "images");
const LABELS = path.join(HUMAN, "labels");
const NOTES = path.join(HUMAN, "notes.jsonl");
const PROMPT = path.join(HUMAN, "live-prompt.txt");
const INTENT = path.join(HUMAN, "live-intent.json");
const PROMPT_LOG = path.join(HUMAN, "prompt-log.jsonl");
const LAST = path.join(HUMAN, "last-reply.json");
const AGENT_IP = process.env.FARM_GOLDEN_IP || "10.250.0.10";
const AGENT_PORT = Number(process.env.FARM_AGENT_PORT || 39200);
const AGENT_TOKEN = process.env.FARM_AGENT_TOKEN || "csfarm";
const OVERLAY_OFF = path.join(VISION, "overlay-off.flag");
const RADAR_CROP = path.join(VISION, "radar-crop.png");
const RADAR_FREEZE = path.join(VISION, "radar-freeze.png");
const RADAR_FREEZE_J = path.join(VISION, "radar-freeze.json");
const RADAR_SELF_HINT = path.join(VISION, "radar-self-hint.json");
const RADAR_TUNE = path.join(VISION, "radar-tune.json");

function readSelfHint() {
  const j = readJson(RADAR_SELF_HINT);
  if (!j || j.reset) return null;
  const nx = Number(j.nx);
  const ny = Number(j.ny);
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;
  return { nx, ny, lock: j.lock !== false };
}

function writeSelfHint(nx, ny) {
  const body = { nx, ny, lock: true, reset: false, at: new Date().toISOString() };
  mkdirSync(VISION, { recursive: true });
  writeFileSync(RADAR_SELF_HINT, JSON.stringify(body, null, 2), "utf8");
  return { nx, ny, lock: true };
}

function clearSelfHint() {
  mkdirSync(VISION, { recursive: true });
  writeFileSync(
    RADAR_SELF_HINT,
    JSON.stringify({ reset: true, at: new Date().toISOString() }, null, 2),
    "utf8"
  );
  return null;
}
const RADAR_TUNE_DEF = { wall_max: 92, wall_fill: 38, occ_n: 48 };

function readRadarTune() {
  const j = readJson(RADAR_TUNE) || {};
  const wall_max = Math.max(40, Math.min(110, Number(j.wall_max) || RADAR_TUNE_DEF.wall_max));
  const wall_fill = Math.max(12, Math.min(80, Number(j.wall_fill) || RADAR_TUNE_DEF.wall_fill));
  const occ_n = Math.max(24, Math.min(80, Number(j.occ_n) || RADAR_TUNE_DEF.occ_n));
  return { wall_max, wall_fill, occ_n };
}

function writeRadarTune(p = {}) {
  const cur = readRadarTune();
  const next = {
    wall_max: Math.max(40, Math.min(110, Number(p.wall_max ?? cur.wall_max))),
    wall_fill: Math.max(12, Math.min(80, Number(p.wall_fill ?? cur.wall_fill))),
    occ_n: Math.max(24, Math.min(80, Number(p.occ_n ?? cur.occ_n)))
  };
  mkdirSync(VISION, { recursive: true });
  writeFileSync(RADAR_TUNE, JSON.stringify(next, null, 2), "utf8");
  return next;
}
const WALK_LOG = path.join(VISION, "lab-walk.log");
const BLACK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

function overlayEnabled() {
  return !existsSync(OVERLAY_OFF);
}

function setOverlayEnabled(on) {
  mkdirSync(VISION, { recursive: true });
  if (on) {
    try {
      unlinkSync(OVERLAY_OFF);
    } catch {}
  } else {
    writeFileSync(OVERLAY_OFF, "1");
    try {
      writeFileSync(path.join(VISION, "overlay-glass.png"), BLACK_PNG);
    } catch {}
  }
  return overlayEnabled();
}

const RECORD_STATUS = path.join(VISION, "human-record", "status.json");
const NAMES = ["c", "ch", "t", "th", "wall", "turn", "climb", "cover", "drop", "look", "gun"];
const CLASS_FILE = path.join(__dirname, "cv", "classes.json");
const CLASSES = (() => {
  try {
    return JSON.parse(readFileSync(CLASS_FILE, "utf8")).classes || [];
  } catch {
    return NAMES.map((name, id) => ({ id, name, label: name, color: "#ccc" }));
  }
})();
if (CLASSES.length) {
  NAMES.length = 0;
  for (const c of CLASSES) NAMES.push(c.name);
}
const CLS_MAX = Math.max(0, ...CLASSES.map((c) => Number(c.id) || 0), NAMES.length - 1);

function png(res, file, req) {
  if (!existsSync(file)) {
    res.writeHead(404);
    res.end();
    return;
  }
  let st;
  try {
    st = statSync(file);
  } catch {
    res.writeHead(404);
    res.end();
    return;
  }
  const etag = `"${Math.round(st.mtimeMs)}-${st.size}"`;
  if (req && String(req.headers["if-none-match"] || "") === etag) {
    res.writeHead(304, {
      etag,
      "cache-control": "no-store"
    });
    res.end();
    return;
  }
  const buf = readFileSync(file);
  const ctype = /\.jpe?g$/i.test(file) ? "image/jpeg" : "image/png";
  res.writeHead(200, {
    "content-type": ctype,
    "cache-control": "no-store",
    etag,
    "last-modified": st.mtime.toUTCString(),
    "content-length": buf.length
  });
  res.end(buf);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function json(res, code, body) {
  const raw = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(raw) });
  res.end(raw);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

function countSamples() {
  mkdirSync(LABELS, { recursive: true });
  return readdirSync(LABELS).filter((f) => f.endsWith(".txt")).length;
}

function countCls(id) {
  mkdirSync(LABELS, { recursive: true });
  const want = String(id);
  let n = 0;
  for (const f of readdirSync(LABELS).filter((x) => x.endsWith(".txt"))) {
    const t = readFileSync(path.join(LABELS, f), "utf8");
    for (const line of t.split(/\n/)) {
      const a = line.trim().split(/\s+/)[0];
      if (a === want) n += 1;
    }
  }
  return n;
}

let trainHintAt = 0;
let trainHint = false;
function yoloTrainRunning() {
  if (Date.now() - trainHintAt < 5000) return trainHint;
  trainHintAt = Date.now();
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -match 'train_yolo.py' } | Select-Object -First 1 -ExpandProperty ProcessId"
    ],
    { encoding: "utf8", windowsHide: true, timeout: 8000 }
  );
  trainHint = Boolean(String(r.stdout || "").trim());
  return trainHint;
}

function snapshotRadar(frame) {
  const src = existsSync(RADAR_CROP) ? RADAR_CROP : path.join(VISION, "radar-paths.png");
  if (existsSync(src)) copyFileSync(src, RADAR_FREEZE);
  const live = (readJson(path.join(VISION, "frame.json")) || {}).radar || null;
  const radar = { ...(frame && frame.radar ? frame.radar : {}), ...(live || {}) };
  writeFileSync(RADAR_FREEZE_J, JSON.stringify({ radar, at: new Date().toISOString() }), "utf8");
  return existsSync(RADAR_FREEZE);
}

function savePlan(plan, extra = {}) {
  const body = { ...plan, ...extra, at: new Date().toISOString() };
  try {
    writeFileSync(LAST_PLAN, JSON.stringify(body, null, 2), "utf8");
    appendFileSync(
      WALK_LOG,
      new Date().toISOString() +
        " plan ok=" +
        Boolean(plan?.ok) +
        " reason=" +
        (plan?.reason || "") +
        " walls=" +
        (plan?.debug?.wallPct ?? plan?.occCells) +
        " n=" +
        ((plan?.path || []).length) +
        " self=" +
        JSON.stringify(plan?.self || null) +
        " goal=" +
        JSON.stringify(plan?.goal || extra.goal || null) +
        "\n",
      "utf8"
    );
  } catch {}
}

function frozenFrame() {
  const j = readJson(RADAR_FREEZE_J);
  if (!j || !j.radar) return null;
  return { radar: j.radar };
}

function labBundle() {
  const live = readJson(path.join(VISION, "frame.json")) || {};
  const freeze = frozenFrame();
  const radarSrc = freeze || live;
  const self = readJson(path.join(VISION, "self.json")) || {};
  const lab = readLab();
  const radar = radarSrc.radar || {};
  const me = selfOnRadar(radarSrc, self);
  const face = facingDeg(self, radar);
  const best = path.join(FARM_ROOT, "ops", "yolo", "best.pt");
  const selfPath = path.join(VISION, "self.json");
  let selfAgeMs = null;
  try {
    selfAgeMs = Date.now() - statSync(selfPath).mtimeMs;
  } catch {}
  return {
    lab,
    stages: readStages(),
    map: self.map || "",
    pos: self.pos || null,
    forward: self.forward || null,
    facing: face,
    selfRadar: me,
    wallAhead: Boolean(radar.wall_ahead),
    radarOk: Boolean(radar.ok),
    navmesh: false,
    geometry: false,
    radarFile: existsSync(RADAR_FREEZE) || existsSync(RADAR_CROP),
    radarFrozen: existsSync(RADAR_FREEZE),
    yoloN: Array.isArray(live.yolo?.dets) ? live.yolo.dets.length : 0,
    yoloDets: Array.isArray(live.yolo?.dets) ? live.yolo.dets : [],
    yoloBackend: live.yolo?.backend || "",
    yoloMs: live.yolo?.ms,
    occupancyN: Array.isArray((live.radar || {}).occupancy) ? live.radar.occupancy.length : Array.isArray(radar.occupancy) ? radar.occupancy.length : 0,
    occupancy: Array.isArray((live.radar || {}).occupancy) ? live.radar.occupancy : radar.occupancy || null,
    radarReason: live.radar?.reason || radar.reason || "",
    radarHeld: Boolean((live.radar || {}).self?.held || radar.self?.held),
    wallCut: live.radar?.wall_cut ?? radar.wall_cut,
    wallFill: live.radar?.wall_fill ?? radar.wall_fill,
    liveSelf: selfOnRadar(live, self),
    selfHint: readSelfHint(),
    tune: readRadarTune(),
    hasLive: existsSync(LIVE),
    weights: { path: best, exists: existsSync(best), bytes: existsSync(best) ? statSync(best).size : 0 },
    labeled: countSamples(),
    trainOn: yoloTrainRunning(),
    gsiAlive: Boolean(self.alive),
    selfAgeMs,
    classes: CLASSES.filter((c) => c.use === "detect"),
    drive: walkDriveStatus(),
  };
}

async function guestRelease() {
  const vks = [0x57, 0x41, 0x53, 0x44, 0x20];
  for (const vk of vks) {
    try {
      await fetch(`http://${AGENT_IP}:${AGENT_PORT}/input`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${AGENT_TOKEN}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ kind: "keyup", vk }),
        signal: AbortSignal.timeout(2500)
      });
    } catch {}
  }
}

function nodePids(re) {
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { $_.ProcessId.ToString() + '|' + $_.CommandLine }"
    ],
    { encoding: "utf8", windowsHide: true, timeout: 8000 }
  );
  const hits = [];
  for (const line of String(r.stdout || "").split(/\r?\n/)) {
    const i = line.indexOf("|");
    if (i < 1) continue;
    const pid = Number(line.slice(0, i));
    const cmd = line.slice(i + 1);
    if (pid && re.test(cmd)) hits.push(pid);
  }
  return hits;
}

function killPids(pids) {
  for (const pid of pids) {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
  }
}

function recordOn() {
  return nodePids(/record-human\.mjs/).length > 0;
}

function readRecord() {
  const st = readJson(RECORD_STATUS) || {};
  const t = Date.parse(st.at || 0);
  const age = Number.isFinite(t) ? Date.now() - t : 999999;
  const beating = Boolean(st.session) && st.on !== false && age < 20000;
  const starting = Boolean(st.starting) && !beating && age < 15000;
  return {
    on: beating,
    starting,
    session: st.session || "",
    fires: st.fires || 0,
    keys: st.keys || 0,
    frames: st.frames || 0,
    gsi: st.gsi || 0,
    ticks: st.ticks || 0,
    samples: st.samples || 0,
    at: st.at || "",
    pid: st.pid || 0,
    err: st.err || ""
  };
}

function killPid(pid) {
  const n = Number(pid);
  if (!n) return;
  spawnSync("taskkill", ["/PID", String(n), "/T", "/F"], { windowsHide: true });
}

async function grabLiveTries(n = 3) {
  for (let i = 0; i < n; i++) {
    if (await grabLive()) return true;
  }
  return false;
}

function liveStamp() {
  try {
    return Math.floor(statSync(LIVE).mtimeMs);
  } catch {
    return Date.now();
  }
}

function startHumanRecord() {
  try {
    killPid(readFileSync(path.join(VISION, "farm-bot.pid"), "utf8"));
  } catch {}
  killPid((readJson(RECORD_STATUS) || {}).pid);
  mkdirSync(path.dirname(RECORD_STATUS), { recursive: true });
  writeFileSync(
    RECORD_STATUS,
    JSON.stringify({ on: false, starting: true, at: new Date().toISOString(), fires: 0, keys: 0, frames: 0 }, null, 2)
  );
  brainAppend("record", { event: "start", starting: true });
  try {
    unlinkSync(path.join(VISION, "human-record", "stop.flag"));
  } catch {}
  const spawnLog = path.join(VISION, "human-record", "spawn.log");
  mkdirSync(path.dirname(spawnLog), { recursive: true });
  const fd = openSync(spawnLog, "a");
  setTimeout(() => {
    const child = spawn(process.execPath, ["record-human.mjs"], {
      cwd: __dirname,
      detached: true,
      stdio: ["ignore", fd, fd],
      windowsHide: true,
      env: {
        ...process.env,
        FARM_RECORD_MS: String(60 * 60 * 1000),
        FARM_RECORD_FRAME_MS: "800",
        FARM_RECORD_KEY_MS: "50",
        FARM_RECORD_CV: "1"
      }
    });
    child.unref();
    brainAppend("record", { event: "spawn", pid: child.pid });
  }, 400);
}

function dropRecordSession(session) {
  const name = String(session || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!name.startsWith("human-")) return;
  const dir = path.join(VISION, "human-record", name);
  if (!dir.toLowerCase().startsWith(path.join(VISION, "human-record").toLowerCase())) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
}

function stopHumanRecord(opts = {}) {
  const prev = readJson(RECORD_STATUS) || {};
  mkdirSync(path.join(VISION, "human-record"), { recursive: true });
  try {
    writeFileSync(path.join(VISION, "human-record", "stop.flag"), "1");
  } catch {}
  if (prev.session) {
    try {
      writeFileSync(path.join(VISION, "human-record", prev.session, "stop.flag"), "1");
    } catch {}
  }
  let st = prev;
  for (let i = 0; i < 40; i++) {
    spawnSync("powershell", ["-NoProfile", "-Command", "Start-Sleep -Milliseconds 200"], { windowsHide: true });
    st = readJson(RECORD_STATUS) || st;
    if (st.flushed) break;
  }
  if (!st.flushed) killPid(prev.pid);
  if (opts.drop) dropRecordSession(st.session || prev.session);
  writeFileSync(
    RECORD_STATUS,
    JSON.stringify(
      {
        ...st,
        on: false,
        starting: false,
        dropped: Boolean(opts.drop),
        flushed: true,
        at: new Date().toISOString()
      },
      null,
      2
    )
  );
  brainAppend("record", {
    event: opts.drop ? "drop" : "keep",
    session: st.session || prev.session || "",
    gsi: st.gsi || 0,
    keys: st.keys || 0,
    frames: st.frames || 0,
    fires: st.fires || 0,
    ticks: st.ticks || 0,
    samples: st.samples || 0
  });
  try {
    unlinkSync(path.join(VISION, "human-record", "stop.flag"));
  } catch {}
  const child = spawn(process.execPath, ["farm.mjs", "bot"], {
    cwd: __dirname,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
}

const ACTION_MAP = {
  aim: "fight-push",
  peek: "fight-peek",
  walk: "walk-w",
  "walk-w": "walk-w",
  "walk-a": "walk-a",
  "walk-d": "walk-d",
  "walk-s": "walk-s",
  "walk-wa": "walk-wa",
  "walk-wd": "walk-wd",
  jump: "curb-jump",
  climb: "curb-jump",
  "radar-turn": "radar-turn",
  wait: "wait",
  buy: "wait",
  pickup: "pickup"
};

function lootFromBoxes(boxes) {
  const list = Array.isArray(boxes) ? boxes : [];
  const g = list.find((x) => NAMES[Math.max(0, Math.min(CLS_MAX, Number(x.cls) | 0))] === "gun");
  if (!g || !Number.isFinite(Number(g.cx))) return null;
  return { x: Math.max(0, Math.min(100, Number(g.cx) * 100)), y: Math.max(0, Math.min(100, Number(g.cy) * 100)) };
}

function hintFromBoxes(boxes) {
  const list = Array.isArray(boxes) ? boxes : [];
  const named = list.map((x) => NAMES[Math.max(0, Math.min(CLS_MAX, Number(x.cls) | 0))] || "");
  if (named.includes("gun")) return { action: "pickup", text: "подбери ган" };
  if (named.includes("turn")) return { action: "radar-turn", text: "развернись" };
  const look = list.filter((_, i) => named[i] === "look");
  if (look.length) {
    const cx = Number(look[0].cx);
    const side = Number.isFinite(cx) && cx < 0.5 ? "влево" : "вправо";
    return { action: "radar-turn", text: "смотри " + side };
  }
  return null;
}

function applyPrompt(text, actionPick, boxes, extra = {}) {
  mkdirSync(HUMAN, { recursive: true });
  const hudNote = String(extra.hudNote || extra.world || extra.clockNote || "").trim();
  const radarNote = String(extra.radarNote || "").trim();
  const walkNote = String(extra.walkNote || "").trim();
  const aimNote = String(extra.aimNote || "").trim();
  const walk = String(extra.walk || "").trim();
  const aim = String(extra.aim || "").trim();
  const timing = String(extra.timing || "auto").trim() || "auto";
  const raw = [String(text || "").trim(), hudNote, radarNote, walkNote, aimNote].filter(Boolean).join("\n");
  const parsed = parsePrompt(raw);
  const boxHint = hintFromBoxes(boxes);
  let pick = String(actionPick || walk || "").trim();
  if (ACTION_MAP[pick]) pick = ACTION_MAP[pick];
  if (pick === "turn" || pick === "look") pick = "radar-turn";
  if (aim === "yolo-head" || aim === "yolo-body") pick = pick || "fight-push";
  if (!pick && boxHint) pick = boxHint.action;
  if (pick || hudNote || radarNote || walkNote || aimNote || aim || (Array.isArray(boxes) && boxes.length)) {
    parsed.ok = true;
    parsed.understood = true;
    parsed.action = pick || parsed.action;
    const bits = [];
    if (boxes?.length) bits.push("боксов " + boxes.length);
    if (hudNote) bits.push("HUD: " + hudNote);
    if (radarNote) bits.push("радар: " + radarNote);
    if (walk) bits.push("ход " + walk);
    if (walkNote) bits.push("ходьба: " + walkNote);
    if (aim) bits.push("мышь " + aim);
    if (aimNote) bits.push("прицел: " + aimNote);
    bits.push(timing === "off" ? "часы выкл" : "часы вкл");
    if (lootFromBoxes(boxes)) bits.push("ган на полу");
    if (pick && PROMPT_SAY[pick]) bits.push(PROMPT_SAY[pick]);
    parsed.say = "ПОНЯЛ. ушло: " + (bits.join(" | ") || "кадр");
  }
  const boxed = Array.isArray(boxes) && boxes.length > 0;
  if (!parsed.understood && boxed) {
    parsed.ok = true;
    parsed.understood = true;
    parsed.action = parsed.action || null;
    parsed.say = "понял: кадр размечен, глаза учатся по боксам";
  }
  const stored = raw || boxHint?.text || (parsed.understood ? String(parsed.action || "") : "");
  if (parsed.understood && stored) writeFileSync(PROMPT, stored, "utf8");
  let prevLoot = null;
  try {
    prevLoot = JSON.parse(readFileSync(INTENT, "utf8")).loot || null;
  } catch {}
  const intent = {
    world: hudNote,
    hudNote,
    radarNote,
    walkNote,
    aimNote,
    walk: walk || (String(parsed.action || "").startsWith("walk-") ? parsed.action : ""),
    aim: aim || "",
    timing,
    clockNote: hudNote,
    loot: lootFromBoxes(boxes) || prevLoot || null,
    action: parsed.action || null
  };
  writeFileSync(INTENT, JSON.stringify(intent, null, 2), "utf8");
  const frame = readJson(path.join(VISION, "frame.json")) || {};
  const thinkLive = readJson(path.join(VISION, "think-last.json")) || {};
  const decision = readJson(path.join(VISION, "decision.json")) || {};
  const self = readJson(path.join(VISION, "self.json")) || {};
  const timingLive = readJson(path.join(VISION, "timing.json")) || {};
  const parts = channelParts(frame, thinkLive, decision, self, timingLive, intent);
  const lessons = [
    ["hud", hudNote],
    ["radar", radarNote],
    ["walk", walkNote || walk],
    ["aim", aimNote || aim],
    ["eyes", Array.isArray(boxes) && boxes.length ? "boxes " + boxes.length : ""]
  ];
  for (const [kind, note] of lessons) {
    if (!note) continue;
    brainAppend(kind, {
      note,
      see: parts[kind]?.see || "",
      think: parts[kind]?.think || "",
      understood: parsed.understood
    });
  }
  const row = {
    at: new Date().toISOString(),
    text: raw,
    understood: parsed.understood,
    action: parsed.action,
    say: parsed.say,
    intent
  };
  appendFileSync(PROMPT_LOG, JSON.stringify(row) + "\n", "utf8");
  writeFileSync(LAST, JSON.stringify(row, null, 2), "utf8");
  return row;
}

function lastReply() {
  try {
    return JSON.parse(readFileSync(LAST, "utf8"));
  } catch {
    return null;
  }
}

function promptLogTail(n = 8) {
  if (!existsSync(PROMPT_LOG)) return [];
  return readFileSync(PROMPT_LOG, "utf8")
    .trim()
    .split(/\n/)
    .filter(Boolean)
    .slice(-n);
}

function brainLogText(kind, n = 8) {
  const { lines } = brainTail(kind, n);
  if (!lines.length) return "";
  return lines
    .map((line) => {
      try {
        const o = JSON.parse(line);
        const t = String(o.at || "").slice(11, 19);
        return t + "  " + String(o.note || o.think || o.text || o.say || "").slice(0, 200);
      } catch {
        return String(line).slice(0, 200);
      }
    })
    .join("\n");
}

function channelParts(frame, think, decision, self, timing, intent) {
  const dets = Array.isArray(frame?.yolo?.dets) ? frame.yolo.dets : [];
  const names = dets.slice(0, 8).map((d) => d.name || d.label || "?").join(" ");
  const radar = frame?.radar || {};
  const sig = timing?.urgent || timing?.soft;
  const gun = String(self?.weapon || "?").replace(/^weapon_/, "");
  const why = String(think?.why || decision?.reason || "");
  return {
    eyes: {
      see: "классы " + (names || "пусто") + " n=" + dets.length,
      think: dets.length ? "есть боксы модели" : "никого не вижу"
    },
    hud: {
      see: [
        gun + "  " + (self?.ammo ?? "?") + "/" + (self?.ammoReserve ?? "?") + "  $" + (self?.money ?? "?"),
        "hp " + (self?.health ?? "?") + " броня " + (self?.armor ?? "?") + (self?.helmet ? " шлем" : ""),
        "бомба " + (self?.bomb || "-") + "  " + (self?.freeze ? "freeze" : (self?.clock || "")),
        self?.spectating ? "спект" : (self?.alive === false ? "труп" : "живой"),
        self?.buy || ""
      ]
        .filter(Boolean)
        .join("\n"),
      think: sig ? sig.kind + " " + (sig.why || "") : self?.buy || "нет срочного сигнала"
    },
    radar: {
      see: "foes " + Number(radar.enemy_count || 0) + " wall " + (radar.wall_ahead ? "1" : "0") + " face " + (radar.facing_deg ?? "-"),
      think: radar.ok ? (radar.wall_ahead ? "стена впереди, ищи обход" : "путь вперёд") : "кроп мимо"
    },
    walk: {
      see: "do " + (decision?.reason || think?.do || "-"),
      think: why || "prefer/ход"
    },
    aim: {
      see: "режим " + (intent?.aim || "-") + " yolo " + dets.length,
      think: /fight|yolo|head/i.test(why + " " + String(intent?.aim || "")) ? "цельюсь" : "мышь не тяну"
    }
  };
}

async function grabLive() {
  const auth = { authorization: "Bearer " + AGENT_TOKEN };
  try {
    await fetch(`http://${AGENT_IP}:${AGENT_PORT}/see`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(20000)
    });
    const r = await fetch(`http://${AGENT_IP}:${AGENT_PORT}/shot?token=${encodeURIComponent(AGENT_TOKEN)}`, {
      headers: auth,
      signal: AbortSignal.timeout(20000)
    });
    if (!r.ok) return false;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 80) return false;
    writeFileSync(LIVE, buf);
    return true;
  } catch {
    return false;
  }
}

function startYoloTrain() {
  const logFile = path.join(FARM_ROOT, "ops", "yolo", "train.log");
  trainHintAt = 0;
  if (yoloTrainRunning()) return logFile;
  const py = process.env.FARM_PYTHON || "C:/Users/R00/AppData/Local/Programs/Python/Python312/python.exe";
  const script = path.join(__dirname, "cv", "train_yolo.py");
  mkdirSync(path.dirname(logFile), { recursive: true });
  const fd = openSync(logFile, "a");
  spawn(py, ["-u", script], {
    cwd: path.join(__dirname, "cv"),
    detached: true,
    stdio: ["ignore", fd, fd],
    windowsHide: true
  }).unref();
  trainHint = true;
  trainHintAt = Date.now();
  return logFile;
}

function ask(boxes, note, action) {
  return [];
}

mkdirSync(IMAGES, { recursive: true });
mkdirSync(LABELS, { recursive: true });

const server = createServer(async (req, res) => {
  try {
  const url = new URL(req.url || "/", "http://local");
  const route = url.pathname;

  if (route === "/" || route === "/teach") {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
      pragma: "no-cache"
    });
    res.end(readFileSync(HTML));
    return;
  }
  if (route === "/lab.css") {
    res.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "no-store" });
    res.end(readFileSync(path.join(__dirname, "cv", "lab.css")));
    return;
  }
  if (route === "/lab.js") {
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
    res.end(readFileSync(path.join(__dirname, "cv", "lab.js")));
    return;
  }
  if (route === "/legacy") {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
      pragma: "no-cache"
    });
    res.end(readFileSync(HTML_LEGACY));
    return;
  }
  if (route === "/brain" || route === "/logs") {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
      pragma: "no-cache"
    });
    res.end(readFileSync(HTML_BRAIN));
    return;
  }
  if (route === "/live.png") return png(res, LIVE);
  if (route === "/preview.jpg") {
    const p = path.join(VISION, "preview.jpg");
    return png(res, p, req);
  }
  if (route === "/overlay.png") {
    const o = path.join(VISION, "overlay.png");
    return png(res, existsSync(o) ? o : LIVE);
  }
  if (route === "/overlay-glass.png") {
    const g = path.join(VISION, "overlay-glass.png");
    return png(res, g, req);
  }
  if (route === "/radar.png") {
    const live = url.searchParams.get("live") === "1";
    const c = live ? RADAR_CROP : existsSync(RADAR_FREEZE) ? RADAR_FREEZE : RADAR_CROP;
    const p = path.join(VISION, "radar-paths.png");
    return png(res, existsSync(c) ? c : p);
  }
  if (route === "/radar-paths.png") {
    const p = path.join(VISION, "radar-paths.png");
    const c = path.join(VISION, "radar-crop.png");
    return png(res, existsSync(p) ? p : c);
  }
  if (route === "/api/hud" && req.method === "GET") {
    const frame = readJson(path.join(VISION, "frame.json")) || {};
    const think = readJson(path.join(VISION, "think-last.json")) || {};
    const decision = readJson(path.join(VISION, "decision.json")) || {};
    const yolo = frame.yolo || {};
    const radar = frame.radar || {};
    const self = readJson(path.join(VISION, "self.json")) || {};
    const timing = readJson(path.join(VISION, "timing.json"));
    let intentCur = {};
    try {
      intentCur = JSON.parse(readFileSync(INTENT, "utf8") || "{}");
    } catch {}
    const parts = channelParts(frame, think, decision, self, timing, intentCur);
    return json(res, 200, {
      ok: true,
      samples: countSamples(),
      wallsMarked: countCls(4),
      trainOn: yoloTrainRunning(),
      hasLive: existsSync(LIVE),
      hasOverlay: existsSync(path.join(VISION, "overlay.png")),
      screen: frame.screen || "",
      mean: frame.mean,
      yoloN: Array.isArray(yolo.dets) ? yolo.dets.length : 0,
      yoloDets: Array.isArray(yolo.dets) ? yolo.dets : [],
      yoloOk: Boolean(yolo.ok),
      radarOk: Boolean(radar.ok),
      radarCrop: radar.crop || readJson(path.join(VISION, "radar-crop.json")) || null,
      foes: Number(radar.enemy_count || 0),
      wall: Boolean(radar.wall_ahead),
      face: radar.facing_deg,
      think,
      reason: decision.reason || think.why || "",
      action: decision.action || think.do || "",
      see: think.see || "",
      train: (function () {
        const p = path.join(FARM_ROOT, "ops", "yolo", "train.log");
        if (!existsSync(p)) return "train not started";
        const t = readFileSync(p, "utf8").trim().split(/\n/);
        return t.slice(-6).join("\n");
      })(),
      hasBest: existsSync(path.join(FARM_ROOT, "ops", "yolo", "best.pt")),
      prompt: existsSync(PROMPT) ? readFileSync(PROMPT, "utf8").trim() : "",
      lock: readLock(),
      policy: { id: activePolicyId(), ids: POLICY_IDS, activate: readActivate(), pending: readJson(path.join(VISION, "policy.json")) },
      policyLive: readJson(path.join(VISION, "policy-live.json")),
      dataset: readJson(path.join(FARM_ROOT, "ops", "datasets", "manifest.json")),
      lastBcEval: readJson(path.join(FARM_ROOT, "ops", "eval", "bc-vs-fsm.json")),
      logs: promptLogTail(6),
      stack: readStack(),
      prompts: promptLogTail(80).length,
      team: self.team || "",
      foe: self.foe || "",
      ally: self.ally || "",
      dm: Boolean(self.dm),
      ammo: self.ammo,
      ammoReserve: self.ammoReserve,
      bomb: self.bomb,
      bombCountdown: self.bombCountdown,
      clock: self.clock,
      freeze: Boolean(self.freeze),
      weapon: self.weapon || "",
      hasStarGun: Boolean(self.hasStarGun),
      alive: self.alive !== false,
      spectating: Boolean(self.spectating),
      health: self.health,
      armor: self.armor,
      money: self.money,
      helmet: Boolean(self.helmet),
      kit: Boolean(self.kit),
      loadout: self.loadout || "",
      flashes: self.flashes,
      smokes: self.smokes,
      hes: self.hes,
      molly: self.molly,
      buy: self.buy || "",
      timing,
      parts,
      chanLogs: {
        eyes: brainLogText("eyes"),
        hud: brainLogText("hud"),
        radar: brainLogText("radar"),
        walk: brainLogText("walk"),
        aim: brainLogText("aim")
      },
      reward: readJson(path.join(VISION, "last-reward.json")),
      record: readRecord(),
      brainFiles: brainFiles()
    });
  }
  if (route === "/api/brain" && req.method === "GET") {
    const kind = String(url.searchParams.get("kind") || "think").replace(/[^a-z]/g, "") || "think";
    const n = Math.min(400, Math.max(20, Number(url.searchParams.get("n") || 120)));
    const t = brainTail(kind, n);
    return json(res, 200, { ok: true, kind, ...t, files: brainFiles() });
  }
  if (route === "/api/intent" && req.method === "POST") {
    const b = await readBody(req);
    let cur = {};
    try {
      cur = JSON.parse(readFileSync(INTENT, "utf8") || "{}");
    } catch {}
    const next = {
      walk: "walk-w",
      aim: "yolo-head",
      timing: "auto",
      ...cur,
      ...(b.walk != null ? { walk: b.walk } : {}),
      ...(b.aim != null ? { aim: b.aim } : {}),
      ...(b.timing != null ? { timing: b.timing } : {})
    };
    mkdirSync(HUMAN, { recursive: true });
    writeFileSync(INTENT, JSON.stringify(next, null, 2), "utf8");
    if (next.walk) writeFileSync(PROMPT, String(next.walk), "utf8");
    return json(res, 200, { ok: true, intent: next, say: "сейчас " + (next.walk || "-") + " / " + (next.aim || "без прицела") });
  }
  if (route === "/api/play-record" && req.method === "POST") {
    const b = await readBody(req);
    const act = String(b.action || "").toLowerCase();
    const cur = readRecord();
    if (act === "drop" || act === "cancel") {
      stopHumanRecord({ drop: true });
      return json(res, 200, { ok: true, on: false, say: "запись отменена, файлы стёрты, бот снова водит", record: readRecord() });
    }
    if (act === "keep" || act === "save") {
      if (cur.on || cur.starting) stopHumanRecord({ drop: false });
      return json(res, 200, { ok: true, on: false, say: "запись сохранена, бот снова водит", record: readRecord() });
    }
    if (cur.on || cur.starting) {
      return json(res, 200, { ok: true, on: true, say: "уже пишем", record: cur });
    }
    startHumanRecord();
    return json(res, 200, { ok: true, on: false, starting: true, say: "запись стартует. потом сохрани или отмени", record: readRecord() });
  }
  if (route === "/api/policy" && req.method === "POST") {
    const b = await readBody(req);
    const id = setPolicyId(b.id || b.policy);
    return json(res, 200, { ok: true, policy: { id, pending: true, ids: POLICY_IDS }, say: "pending " + id + ". не активна пока не подтвердишь" });
  }
  if (route === "/api/policy-activate" && req.method === "POST") {
    const b = await readBody(req);
    if (b.confirm !== true && b.ok !== true) {
      return json(res, 400, { ok: false, say: "нужен confirm:true" });
    }
    const id = confirmPolicy(b.id || b.policy || "fsm");
    return json(res, 200, { ok: true, policy: { id, confirmed: true }, say: "активна " + id });
  }
  if (route === "/api/dataset-qc" && req.method === "POST") {
    await readBody(req);
    const m = runDatasetQc();
    return json(res, 200, { ok: true, dataset: m, say: "qc ok=" + m.ok + " quarantine=" + m.quarantine.length });
  }
  if (route === "/api/train-bc" && req.method === "POST") {
    await readBody(req);
    const logFile = path.join(FARM_ROOT, "ops", "bc", "train.log");
    mkdirSync(path.dirname(logFile), { recursive: true });
    const fd = openSync(logFile, "a");
    spawn(process.execPath, ["train-bc.mjs"], {
      cwd: __dirname,
      detached: true,
      stdio: ["ignore", fd, fd],
      windowsHide: true
    }).unref();
    return json(res, 200, { ok: true, say: "train-bc started, policy not activated", log: logFile });
  }
  if (route === "/api/grade" && req.method === "POST") {
    const b = await readBody(req);
    const row = voteGrade(b.vote || b.grade || "good");
    return json(res, 200, { ok: true, lock: row });
  }
  if (route === "/api/refresh" && req.method === "POST") {
    await readBody(req);
    const next = await grabLiveTries(3);
    return json(res, 200, { ok: next, next, liveAt: liveStamp() });
  }
  if (route === "/api/overlay" && req.method === "GET") {
    return json(res, 200, { ok: true, enabled: overlayEnabled() });
  }
  if (route === "/api/overlay" && req.method === "POST") {
    const b = await readBody(req);
    const on = !(b.enabled === false || b.enabled === 0 || b.enabled === "0");
    return json(res, 200, { ok: true, enabled: setOverlayEnabled(on) });
  }
  if (route === "/api/stack" && req.method === "GET") {
    return json(res, 200, { ok: true, stack: readStack(), keys: Object.keys(DEFAULT_STACK) });
  }
  if (route === "/api/stack" && req.method === "POST") {
    const b = await readBody(req);
    return json(res, 200, { ok: true, stack: writeStack(b.stack || b) });
  }
  if (route === "/api/prompt-clear" && req.method === "POST") {
    writeFileSync(PROMPT, "", "utf8");
    return json(res, 200, { ok: true, say: "промпт сброшен, мозг без команды" });
  }
  if (route === "/api/train-eyes" && req.method === "POST") {
    const logFile = startYoloTrain();
    return json(res, 200, { ok: true, say: "глаза дообучаются", log: logFile });
  }
  if (route === "/api/classes" && req.method === "GET") {
    return json(res, 200, { ok: true, classes: CLASSES, names: NAMES });
  }
  if (route === "/api/state" && req.method === "GET") {
    return json(res, 200, {
      ok: true,
      samples: countSamples(),
      hasLive: existsSync(LIVE),
      names: NAMES,
      ask: ask([], "", "")
    });
  }
  if (route === "/api/lab/walk-log" && req.method === "GET") {
    let log = "";
    try {
      log = readFileSync(WALK_LOG, "utf8").slice(-12000);
    } catch {}
    const plan = readJson(LAST_PLAN) || {};
    const lab = readLab();
    const text = [
      "drive " + JSON.stringify(walkDriveStatus()),
      "lab " + JSON.stringify({ goal: lab.goal, pathN: (lab.path || []).length, error: lab.error, pathFit: lab.pathFit, grade: lab.grade, skill: lab.skill, confirmed: lab.confirmed, stop: lab.stopReason }),
      "plan " +
        JSON.stringify(plan, (k, v) => (k === "occupancy" ? "[" + ((v && v.length) || 0) + " rows]" : v), 2),
      "--- log ---",
      log || "(пусто)"
    ].join("\n");
    return json(res, 200, { ok: true, text });
  }
  if (route === "/api/lab" && req.method === "GET") {
    return json(res, 200, { ok: true, ...labBundle() });
  }
  if (route === "/api/lab/radar-tune" && req.method === "POST") {
    const b = await readBody(req);
    const tune = writeRadarTune(b);
    return json(res, 200, { ok: true, tune, say: "порог стен записан, сетка справа с живого кадра" });
  }
  if (route === "/api/lab/stages" && req.method === "POST") {
    const b = await readBody(req);
    const id = String(b.id || "");
    if (!["eyes", "walk", "aim", "fire", "strafe", "build"].includes(id)) {
      return json(res, 400, { ok: false, say: "unknown stage" });
    }
    const stages = patchStage(id, {
      lastResult: b.lastResult != null ? String(b.lastResult) : undefined
    });
    return json(res, 200, { ok: true, stages });
  }
  if (route === "/api/lab/walk" && req.method === "POST") {
    const b = await readBody(req);
    const act = String(b.action || "").toLowerCase();
    const frame = readJson(path.join(VISION, "frame.json")) || {};
    const self = readJson(path.join(VISION, "self.json")) || {};
    if (act === "stop") {
      await stopWalkDrive();
      const lab = stopLab("user-stop");
      await guestRelease();
      patchStage("walk", { lastResult: "стоп, клавиши отпущены" });
      return json(res, 200, { ok: true, lab, say: "стоп, клавиши отпущены" });
    }
    if (act === "kick-bots") {
      let bodyOut = {};
      try {
        const r = await fetch(`http://${AGENT_IP}:${AGENT_PORT}/cs/walk-empty`, {
          method: "POST",
          headers: { authorization: `Bearer ${AGENT_TOKEN}`, "content-type": "application/json" },
          body: "{}",
          signal: AbortSignal.timeout(45000)
        });
        bodyOut = await r.json().catch(() => ({}));
        if (!r.ok || bodyOut.ok === false) {
          return json(res, 200, { ok: false, say: "кик не прошёл: " + (bodyOut.error || r.status), guest: bodyOut });
        }
      } catch (e) {
        return json(res, 200, { ok: false, say: "кик не прошёл: " + String(e.message || e) });
      }
      patchStage("walk", { lastResult: "боты кикнуты, quota 0. учим ходьбу" });
      return json(res, 200, { ok: true, say: "ботов кикнул, quota 0. снимок радара и строй маршруты.", guest: bodyOut });
    }
    if (act === "snapshot") {
      snapshotRadar(frame);
      return json(res, 200, { ok: existsSync(RADAR_FREEZE), say: "радар зафиксирован", lab: readLab() });
    }
    if (act === "set-self") {
      const nx = Number(b.nx);
      const ny = Number(b.ny);
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
        return json(res, 400, { ok: false, say: "Нет данных" });
      }
      const hint = writeSelfHint(nx, ny);
      return json(res, 200, { ok: true, selfHint: hint, lab: readLab(), say: "запомнил где ты. дальше ищу рядом с этой точкой." });
    }
    if (act === "clear-self") {
      clearSelfHint();
      return json(res, 200, { ok: true, selfHint: null, lab: readLab(), say: "метку снял, память точки тоже. ищу маленькую яркую точку, не заливку карты." });
    }
    if (act === "set-goal") {
      const nx = Number(b.nx);
      const ny = Number(b.ny);
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
        return json(res, 400, { ok: false, say: "Нет данных", lab: readLab() });
      }
      if (!existsSync(RADAR_FREEZE)) snapshotRadar(frame);
      const lab = writeLab({
        ...readLab(),
        skill: "idle",
        confirmed: false,
        moving: false,
        goal: { nx, ny },
        path: [],
        next: null,
        error: "",
        stopReason: ""
      });
      return json(res, 200, { ok: true, lab, say: "цель записана, маршрут ещё не считали" });
    }
    if (act === "plan") {
      const live = readJson(path.join(VISION, "frame.json")) || frame;
      if (!existsSync(RADAR_FREEZE)) snapshotRadar(live);
      const lab0 = readLab();
      const fused = fuseWalkFrame(live, frozenFrame());
      const plan = planWalk({ frame: fused, gsi: self, goal: lab0.goal || { nx: b.nx, ny: b.ny } });
      savePlan(plan, { goal: lab0.goal });
      const slimOcc = plan.debug?.occupancy || null;
      if (plan.debug) delete plan.debug.occupancy;
      writeLab({
        ...lab0,
        skill: "idle",
        confirmed: false,
        moving: false,
        goal: plan.goal || lab0.goal,
        path: plan.path || [],
        next: plan.next || null,
        pathFit: plan.pathFit,
        grade: null,
        error: plan.ok ? "" : plan.error,
        stopReason: plan.ok ? "" : plan.reason
      });
      if (slimOcc) plan.debug = { ...(plan.debug || {}), occupancy: slimOcc };
      const fit = plan.pathFit == null ? "?" : plan.pathFit;
      return json(res, 200, {
        ok: plan.ok,
        say: plan.ok
          ? "маршрут, " + (plan.path || []).length + " точек, стены " + (plan.debug?.wallPct ?? "?") + "%"
          : plan.error,
        plan,
        lab: readLab()
      });
    }
    if (act === "grade") {
      const v = String(b.ok) === "true" || b.ok === true ? "ok" : "bad";
      const lab0 = readLab();
      if (!Array.isArray(lab0.path) || !lab0.path.length) {
        return json(res, 400, { ok: false, say: "сначала маршрут" });
      }
      const lab = writeLab({ ...lab0, grade: v });
      try {
        appendFileSync(
          path.join(VISION, "walk-grades.jsonl"),
          JSON.stringify({
            at: lab.at,
            grade: v,
            pathFit: lab.pathFit,
            goal: lab.goal,
            n: lab.path.length,
            map: self.map || ""
          }) + "\n",
          "utf8"
        );
      } catch {}
      return json(res, 200, { ok: true, lab, say: v === "ok" ? "ок, маршрут похож" : "записал что путь врёт" });
    }
    if (act === "probe") {
      const probe = await runMoveProbe({ ip: AGENT_IP, port: AGENT_PORT, token: AGENT_TOKEN });
      const say = probe.ok
        ? "probe: пешка сдвинулась, yaw " + (probe.yawChanged ? "да" : "нет")
        : "probe fail: " + (probe.reason || "no-move");
      patchStage("walk", { lastResult: say });
      return json(res, 200, { ok: probe.ok, say, probe });
    }
    if (act === "nudge") {
      const pulse = await nudgeWalk({
        ip: AGENT_IP,
        port: AGENT_PORT,
        token: AGENT_TOKEN,
        ms: 1100
      });
      const say = pulse.ok
        ? "удержал W в VM 1с guest " + (pulse.down?.out || "")
        : "W не ушёл: " + (pulse.down?.out || pulse.up?.out || "fail");
      patchStage("walk", { lastResult: say });
      return json(res, 200, { ok: pulse.ok, say, input: { down: pulse.down, up: pulse.up, sample: pulse.sample }, drive: walkDriveStatus() });
    }
    if (act === "start") {
      if (b.confirm !== true) return json(res, 400, { ok: false, say: "нужно подтверждение" });
      const lab0 = readLab();
      if (!lab0.goal) return json(res, 400, { ok: false, say: "сначала цель и маршрут" });
      const live = readJson(path.join(VISION, "frame.json")) || frame;
      const fused = fuseWalkFrame(live, frozenFrame());
      let pts = Array.isArray(lab0.path) ? lab0.path : [];
      let plan = null;
      if (pts.length < 2) {
        plan = planWalk({ frame: fused, gsi: self, goal: lab0.goal });
        savePlan(plan, { goal: lab0.goal });
        pts = plan.path || [];
      }
      if (pts.length < 2) {
        const me = selfOnRadar(fused, self) || { nx: 0.5, ny: 0.5, source: "fallback" };
        pts = [me, lab0.goal];
      }
      const lab = writeLab({
        ...lab0,
        skill: "walk",
        confirmed: true,
        moving: true,
        path: pts,
        next: pts[1] || lab0.next,
        error: "",
        stopReason: "",
        walkMinDist: null
      });
      try {
        appendFileSync(WALK_LOG, new Date().toISOString() + " start begin path=" + pts.length + "\n", "utf8");
      } catch {}
      let pulse;
      try {
        pulse = await startWalkDrive({
          ip: AGENT_IP,
          port: AGENT_PORT,
          token: AGENT_TOKEN
        });
        try {
          appendFileSync(WALK_LOG, new Date().toISOString() + " start pulse ok=" + pulse.ok + " reason=" + pulse.reason + " sent=" + (pulse.sent || []).length + "\n", "utf8");
        } catch {}
      } catch (e) {
        const err = String(e.message || e);
        try {
          appendFileSync(WALK_LOG, new Date().toISOString() + " start crash " + err + "\n", "utf8");
        } catch {}
        return json(res, 200, { ok: false, say: "drive crash: " + err, lab, drive: walkDriveStatus() });
      }
      const n = (pulse.sent || []).length;
      const say = pulse.ok
        ? "ходьба идёт в VM, клавиш за тик: " + n + " hold=" + ((pulse.lab && pulse.lab.skill) || "") + " " + (pulse.reason || "")
        : "клавиши не ушли: " + (pulse.error || "guest /input fail");
      patchStage("walk", { lastResult: say });
      const st = walkDriveStatus();
      return json(res, 200, {
        ok: pulse.ok,
        say,
        lab: pulse.lab || lab,
        input: pulse.sent,
        drive: { running: st.running, ticks: st.ticks, held: st.held, reason: st.reason, guest: st.guest, error: st.error }
      });
    }
    return json(res, 400, { ok: false, say: "unknown action" });
  }
  if (route === "/api/eyes/test" && req.method === "POST") {
    await readBody(req).catch(() => ({}));
    const frame = readJson(path.join(VISION, "frame.json")) || {};
    const dets = frame.yolo?.dets || [];
    const best = path.join(FARM_ROOT, "ops", "yolo", "best.pt");
    patchStage("eyes", { lastResult: "проверка кадра, объектов: " + dets.length });
    return json(res, 200, {
      ok: true,
      say: "проверка текущего кадра, бота не трогал",
      n: dets.length,
      dets,
      weights: existsSync(best)
    });
  }
  if (route === "/api/preview-ask" && req.method === "POST") {
    const b = await readBody(req);
    return json(res, 200, { ok: true, ask: ask(b.boxes, b.note, b.action) });
  }
  if (route === "/api/prompt" && req.method === "POST") {
    const b = await readBody(req);
    const extra = {
      world: b.world,
      hudNote: b.hudNote,
      radarNote: b.radarNote,
      walkNote: b.walkNote,
      aimNote: b.aimNote,
      walk: b.walk,
      aim: b.aim,
      timing: b.timing,
      clockNote: b.clockNote
    };
    const reply = applyPrompt(b.note || b.prompt, String(b.action || b.walk || "").trim() || null, b.boxes, extra);
    return json(res, 200, { ok: true, ...reply, logs: promptLogTail(8) });
  }
  if (route === "/api/save" && req.method === "POST") {
    const b = await readBody(req);
    const reply = { ok: true, understood: true, say: "боксы глаз. intent не тронут", action: null };
    const boxes = Array.isArray(b.boxes) ? b.boxes : [];
    let samples = countSamples();
    let id = null;
    if (existsSync(LIVE)) {
      id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const img = path.join(IMAGES, id + ".png");
      const lab = path.join(LABELS, id + ".txt");
      copyFileSync(LIVE, img);
      const lines = boxes
        .filter((x) => Number.isFinite(Number(x.cls)) && Number(x.w) > 0.004 && Number(x.h) > 0.004)
        .map((x) => {
          const cls = Math.max(0, Math.min(CLS_MAX, Number(x.cls) | 0));
          const cx = Math.max(0, Math.min(1, Number(x.cx)));
          const cy = Math.max(0, Math.min(1, Number(x.cy)));
          const w = Math.max(0, Math.min(1, Number(x.w)));
          const h = Math.max(0, Math.min(1, Number(x.h)));
          return `${cls} ${cx.toFixed(6)} ${cy.toFixed(6)} ${w.toFixed(6)} ${h.toFixed(6)}`;
        });
      writeFileSync(lab, lines.join("\n") + (lines.length ? "\n" : ""), "utf8");
      samples = countSamples();
    }
    try {
      appendFileSync(
        NOTES,
        JSON.stringify({
          at: new Date().toISOString(),
          id,
          note: b.note || b.prompt || "",
          action: reply.action,
          understood: reply.understood,
          boxes: boxes.length,
          kind: "eyes-labels",
          saved: {
            eyes: boxes.length ? path.join(IMAGES, id + ".png") : null,
            labels: boxes.length ? path.join(LABELS, id + ".txt") : null,
            intent: null,
            notes: NOTES,
            trainQueued: false,
            model: path.join(FARM_ROOT, "ops", "yolo", "best.pt")
          },
        }) + "\n",
        "utf8"
      );
    } catch {}
    const next = await grabLiveTries(3);
    const best = path.join(FARM_ROOT, "ops", "yolo", "best.pt");
    const saved = {
      eyes: id && boxes.length ? path.join(IMAGES, id + ".png") : null,
      labels: id && boxes.length ? path.join(LABELS, id + ".txt") : null,
      intent: null,
      notes: NOTES,
      trainQueued: false,
      model: best,
      modelActive: existsSync(best)
    };
    return json(res, 200, {
      ok: true,
      id,
      samples,
      next,
      liveAt: liveStamp(),
      ...reply,
      logs: promptLogTail(8),
      saved,
      trained: false
    });
  }
  res.writeHead(404);
  res.end("no");
  } catch (e) {
    try {
      appendFileSync(WALK_LOG, new Date().toISOString() + " http " + String(e && e.stack ? e.stack : e) + "\n", "utf8");
    } catch {}
    try {
      if (!res.headersSent) json(res, 500, { ok: false, say: String(e.message || e) });
    } catch {}
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("teach ui http://127.0.0.1:" + PORT);
  console.log("boxes ->", HUMAN);
  try {
    const labGsi = startLabGsi();
    console.log("lab gsi :" + labGsi.port);
  } catch (e) {
    console.log("lab gsi skip", e.message);
  }
});
try {
  const lan = createServer(server.listeners("request")[0]);
  lan.listen(PORT, "10.250.0.1", () => {
    console.log("teach lan http://10.250.0.1:" + PORT);
  });
  lan.on("error", (e) => console.log("teach lan skip", e.message));
} catch (e) {
  console.log("teach lan skip", e.message);
}
