import { jitter, sleepJitter } from "./pace.mjs";
import { parseGsi, startGsi } from "./gsi.mjs";
import { decide } from "./brain.mjs";
import { doBuy, doHold, doNade, doWait, doWalk, doShoot, releaseAll, queueMatch, acceptMatch, runTrainingScript, isTrainingMap, isOfficialFarmMode } from "./macros.mjs";

const mem = { round: -1, bought: false, naded: false, route: null, loot: false, counted: false };
let enabled = true;
let autoMatch = true;
let lastNote = "boot";
let busy = false;
let lastAct = 0;
let lastAccept = 0;
let lastQueueAsk = 0;
let hooks = { onMatchEnd: null, onNeedQueue: null };

export function setBotEnabled(v) {
  enabled = Boolean(v);
  if (!enabled) {
    releaseAll();
    lastNote = "off";
  }
}

export function setAutoMatch(v) {
  autoMatch = Boolean(v);
}

export function setBotHooks(next) {
  hooks = { ...hooks, ...next };
}

export function botNote() {
  return lastNote;
}

export function startBot(port, token) {
  const gsi = startGsi({
    port,
    token,
    onState: () => {}
  });
  loop(gsi);
  return gsi;
}

async function clickAccept() {
  await acceptMatch();
}

async function clickContinue() {
  await queueMatch();
}

async function clickPlay() {
  await queueMatch();
}

let lastGsiKey = "";
let liveSince = 0;

async function loop(gsi) {
  while (true) {
    await sleepJitter(90, 180);
    if (!enabled || busy) continue;
    const raw = gsi.snapshot();
    if (!raw) {
      lastNote = "wait gsi";
      continue;
    }
    const s = parseGsi(raw);
    const key = `${s.mode}|${s.map}|${s.mapPhase}|${s.activity}`;
    if (key !== lastGsiKey) {
      lastGsiKey = key;
      console.log("gsi", s.mode || "-", s.map || "nomap", s.mapPhase || "-", s.activity || "-");
    }
    if (s.mapPhase === "live" && !s.inMenu) {
      if (!liveSince) liveSince = Date.now();
    } else if (s.over) {
      liveSince = 0;
    }
    const now = Date.now();
    if (!s.over && liveSince && Date.now() - liveSince > 8 * 60 * 1000 && (s.inMenu || s.warmup)) {
      lastNote = "end-time";
      releaseAll();
      liveSince = 0;
      if (!mem.counted) {
        mem.counted = true;
        if (hooks.onMatchEnd) await hooks.onMatchEnd({ steamId: s.steamId });
      }
      continue;
    }
    if (s.over) {
      lastNote = "end";
      releaseAll();
      if (!mem.counted) {
        mem.counted = true;
        if (hooks.onMatchEnd) await hooks.onMatchEnd({ steamId: s.steamId });
      }
      if (now - lastAct > 2500) {
        busy = true;
        try {
          await clickContinue();
        } finally {
          busy = false;
          lastAct = Date.now();
        }
      }
      continue;
    }
    const trainingLive =
      s.mapPhase === "live" &&
      !s.inMenu &&
      (isTrainingMap(s.map) || !isOfficialFarmMode(s.mode));
    if (trainingLive) {
      lastNote = "training";
      if (now - lastAct > 800) {
        busy = true;
        try {
          await runTrainingScript();
        } finally {
          busy = false;
          lastAct = Date.now();
        }
      }
      continue;
    }
    if (s.warmup || (s.phase === "live" && s.alive) || s.mapPhase === "live") {
      mem.counted = false;
    }
    if (autoMatch && (s.inMenu || (!s.warmup && !s.alive && s.activity === "menu"))) {
      lastNote = "lobby";
      releaseAll();
      if (now - lastAccept > jitter(7000, 14000)) {
        lastAccept = now;
        busy = true;
        try {
          await clickAccept();
          await sleepJitter(400, 900);
          await clickPlay();
        } finally {
          busy = false;
        }
      }
      if (now - lastQueueAsk > jitter(22000, 40000)) {
        lastQueueAsk = now;
        if (hooks.onNeedQueue) await hooks.onNeedQueue({ steamId: s.steamId });
      }
      continue;
    }
    const act = decide(s, mem);
    lastNote = `${act.type}:${act.reason || ""} r${s.round} ${s.weapon}`.trim();
    if (act.type === "idle") {
      releaseAll();
      continue;
    }
    if (act.type === "wait") {
      await doWait(act.ms);
      continue;
    }
    if (now - lastAct < jitter(180, 420) && act.type === "walk") continue;
    busy = true;
    try {
      if (act.type === "buy") {
        await doBuy(s);
        mem.bought = true;
        lastAct = Date.now();
      } else if (act.type === "hold") {
        await doHold();
        lastAct = Date.now();
      } else if (act.type === "loot") {
        await doWalk(act.route, { loot: true });
        lastAct = Date.now();
      } else if (act.type === "fight") {
        await doWalk(act.route || { steps: [{ walk: jitter(220, 480) }] }, { style: act.style || "forward" });
        await doShoot({ burst: act.burst });
        lastAct = Date.now();
      } else if (act.type === "walk") {
        await doWalk(act.route, { plant: Boolean(act.plant) });
        lastAct = Date.now();
      } else if (act.type === "nade") {
        await doNade(act.kind);
        mem.naded = true;
        lastAct = Date.now();
      }
    } catch (e) {
      lastNote = "err " + String(e.message || e);
      releaseAll();
    }
    busy = false;
    await sleepJitter(220, 780);
  }
}
