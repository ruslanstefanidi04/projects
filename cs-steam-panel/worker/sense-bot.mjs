// unused by farm.mjs. control source of truth is fsm/loop.mjs. do not start this in parallel.
import { parseGsi, startGsi } from "./gsi.mjs";
import { loadWeights, saveWeights, stateKey, pickAction, learn } from "./learn.mjs";
import { makeRewardTracker } from "./reward.mjs";
import { setVisionAgent, seeScreen, doSenseAction, senseClick, senseKey } from "./vision.mjs";
import { releaseAll } from "./input.mjs";
import { sleepJitter, sleep } from "./pace.mjs";

let enabled = true;
let lastNote = "boot";
let busy = false;
const weights = loadWeights();
const rewards = makeRewardTracker();
let lastSave = 0;
let lastVision = { ok: false, cta: null, spots: [] };
let pending = { key: "menu", action: "wait" };
let menuStep = 0;
let lastMenuNav = 0;

export function setSenseEnabled(v) {
  enabled = Boolean(v);
  if (!enabled) releaseAll();
}

export function senseNote() {
  return lastNote;
}

export function startSenseBot(port, token) {
  const gsi = startGsi({
    port,
    token,
    onState: () => {}
  });
  loop(gsi);
  return gsi;
}

export function wireSenseAgent(ip, token = "csfarm", agentPort = 39200) {
  setVisionAgent(ip, token, agentPort);
}

async function navTrainingDay() {
  // calibrated against hv thumbnails: HOME -> PLAY -> PRACTICE -> TRAINING DAY -> GO
  const steps = [
    [18, 5],
    [30, 12],
    [18, 48],
    [20, 52],
    [18, 56],
    [88, 90],
    [90, 92]
  ];
  const i = menuStep % steps.length;
  const [x, y] = steps[i];
  await senseClick(x, y);
  menuStep += 1;
  lastNote = `nav_train#${menuStep} @${x},${y}`;
}

async function loop(gsi) {
  while (true) {
    await sleepJitter(160, 280);
    if (!enabled || busy) continue;
    const raw = gsi.snapshot();
    const s = raw ? parseGsi(raw) : { inMenu: true, map: "", alive: false };
    if (!raw) lastNote = "wait gsi";

    if (!raw || s.inMenu || Math.random() < 0.1) {
      const vision = await seeScreen();
      if (vision.ok) lastVision = vision;
    }

    const scored = rewards.step(s);
    if (scored.learn) {
      learn(weights, pending.key, pending.action, scored.sparse);
      if (Date.now() - lastSave > 8000) {
        saveWeights(weights);
        lastSave = Date.now();
      }
    }
    if (scored.events.length && scored.events[0] !== "boot" && scored.reward !== 0) {
      console.log("reward", scored.reward.toFixed(2), scored.events.join(","), pending.key, pending.action);
    }

    busy = true;
    try {
      if (s.inMenu || !raw) {
        if (Date.now() - lastMenuNav > 900) {
          lastMenuNav = Date.now();
          await navTrainingDay();
          pending = { key: "menu", action: "cta_click" };
        } else {
          lastNote = "menu cool";
        }
      } else {
        menuStep = 0;
        const key = stateKey(s, lastVision);
        let action = pickAction(weights, key, { explore: 0.16 });
        if (s.alive && s.hasC4 && Math.random() < 0.25) action = "plant";
        if (s.alive && s.bomb === "planted" && s.team === "CT" && Math.random() < 0.3) action = "defuse";
        pending = { key, action };
        lastNote = `${key}:${action} r${(scored.reward || 0).toFixed(2)}`;
        await doSenseAction(action, lastVision);
      }
    } catch (e) {
      lastNote = "err " + String(e.message || e);
      releaseAll();
    }
    busy = false;
    await sleep(80);
  }
}
