import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRewardTracker, isSparseEvent } from "../reward.mjs";
import { parseGsi } from "../gsi.mjs";
import { packObservation, validateObservation, obsActionable, MAX_FRAME_AGE_MS } from "../obs.mjs";
import { makeActionController } from "../action-ctl.mjs";
import { makeTrajStep, validateTrajStep, validateTrajectory } from "../dataset-traj.mjs";
import { confirmState } from "../fsm/confirm.mjs";
import { VK } from "../input.mjs";

function live(extra = {}) {
  return {
    kills: 0,
    deaths: 0,
    assists: 0,
    alive: true,
    spectating: false,
    round: 1,
    winTeam: "",
    team: "T",
    hasC4: false,
    bomb: "",
    clock: "mid",
    mapPhase: "live",
    phase: "live",
    inMenu: false,
    ...extra
  };
}

test("kill credited once then zero", () => {
  const r = makeRewardTracker();
  r.step(live());
  const a = r.step(live({ kills: 1 }));
  assert.equal(a.learn, true);
  assert.equal(a.sparse, 10);
  assert.ok(a.events.includes("kill+1"));
  const b = r.step(live({ kills: 1 }));
  assert.equal(b.learn, false);
  assert.equal(b.sparse, 0);
});

test("death not doubled on spectate", () => {
  const r = makeRewardTracker();
  r.step(live({ deaths: 0 }));
  const dead = r.step(live({ alive: false, spectating: true, deaths: 1 }));
  assert.ok(dead.events.includes("death+1"));
  assert.ok(!dead.events.includes("died"));
  const still = r.step(live({ alive: false, spectating: true, deaths: 1 }));
  assert.ok(!still.events.includes("death+1"));
});

test("stuck-spawn is rising edge only", () => {
  const r = makeRewardTracker();
  r.step(live({ zone: "t-spawn", elapsedMs: 5000 }));
  const a = r.step(live({ zone: "t-spawn", elapsedMs: 5000 }));
  assert.ok(a.events.includes("stuck-spawn"));
  const b = r.step(live({ zone: "t-spawn", elapsedMs: 6000 }));
  assert.ok(!b.events.includes("stuck-spawn"));
  assert.equal(b.learn, false);
});

test("isSparseEvent", () => {
  assert.equal(isSparseEvent("kill+1"), true);
  assert.equal(isSparseEvent("afk"), false);
  assert.equal(isSparseEvent("stuck-spawn"), false);
});

test("parseGsi spectate uses provider steamid", () => {
  const s = parseGsi({
    provider: { steamid: "111" },
    player: { steamid: "222", team: "CT", activity: "playing", state: { health: 100, armor: 0, money: 0 } },
    map: { name: "de_mirage", phase: "live", round: 2 },
    round: { phase: "live" }
  });
  assert.equal(s.spectating, true);
  assert.equal(s.alive, false);
});

test("obs rejects stale file only when old", () => {
  const obs = packObservation({
    tickId: 1,
    episodeId: "e1",
    capture: { valid: true, repeated: true, age_ms: 20000, frame_id: 1 },
    frame: { confidence: 0.9, yolo: { dets: [] } },
    gsi: live({ health: 100, activity: "playing" }),
    gsiAgeMs: 10
  });
  assert.equal(obsActionable(obs).ok, false);
});

test("fresh repeat still playable", () => {
  const obs = packObservation({
    tickId: 1,
    capture: { valid: true, repeated: true, age_ms: 200, frame_id: 1 },
    gsi: live({ health: 100, activity: "playing" }),
    gsiAgeMs: 10
  });
  assert.equal(obsActionable(obs).ok, true);
});

test("obs rejects old screenshot", () => {
  const obs = packObservation({
    tickId: 2,
    capture: { valid: true, repeated: false, age_ms: MAX_FRAME_AGE_MS + 10, frame_id: 2 },
    gsi: live({ health: 80, activity: "playing" }),
    gsiAgeMs: 5
  });
  assert.equal(obsActionable(obs).reason, "stale-or-bad-frame");
});

test("action controller gates look when dead", () => {
  const c = makeActionController();
  const g = c.gateStep({ action: "LOOK", dx: 10 }, { alive: false, spectating: false });
  assert.equal(g.ok, false);
  const ui = c.gateStep({ action: "CLICK", x: 50 }, { alive: false });
  assert.equal(ui.ok, true);
  c.noteDown(VK.W);
  assert.deepEqual(c.heldVks(), [VK.W]);
  assert.deepEqual(c.staleHolds(Date.now() + 9000), [VK.W]);
});

test("traj needs done + terminal", () => {
  const a = makeTrajStep({
    episodeId: "ep",
    t: 1,
    action: "walk-w",
    source: "human",
    done: false
  });
  assert.equal(validateTrajStep(a).ok, true);
  const b = makeTrajStep({
    episodeId: "ep",
    t: 2,
    action: "idle",
    source: "human",
    done: true,
    terminal: "record-stop"
  });
  const traj = validateTrajectory([a, b]);
  assert.equal(traj.ok, true);
});

test("traj flags time-back and gap", () => {
  const a = makeTrajStep({ episodeId: "e", t: 1000, action: "walk-w", source: "human", mouse: { dx: 1, dy: 0 } });
  const b = makeTrajStep({ episodeId: "e", t: 500, action: "wait", source: "human", mouse: { dx: 0, dy: 0 } });
  const back = validateTrajectory([a, b], { maxGapMs: 2500 });
  assert.ok(back.errors.some((x) => x.includes("time-back")));
  const c = makeTrajStep({ episodeId: "e", t: 5000, action: "wait", source: "human", done: true, terminal: "end" });
  const gap = validateTrajectory([a, c], { maxGapMs: 2500 });
  assert.ok(gap.errors.some((x) => x.includes("gap")));
});

test("bc majority vs linear on synthetic walk", async () => {
  const { comparePolicies } = await import("../bc.mjs");
  const obs = (nx) => ({
    player: { alive: true, health: 100 },
    weapon: { ammo: 20 },
    radar: { wall_ahead: false, enemy_count: 0, self: { nx, ny: 0.5 } },
    detections: [],
    round: { clock: "execute" }
  });
  const train = [];
  for (let i = 0; i < 30; i++) {
    train.push({ observation: obs(0.2), keys: { W: true, A: true, dx: 0, dy: 0 }, action: "walk-wa" });
    train.push({ observation: obs(0.8), keys: { W: true, D: true, dx: 0, dy: 0 }, action: "walk-wd" });
  }
  const val = [
    { observation: obs(0.2), keys: { W: true, A: true, dx: 0, dy: 0 }, action: "walk-wa" },
    { observation: obs(0.8), keys: { W: true, D: true, dx: 0, dy: 0 }, action: "walk-wd" }
  ];
  const r = comparePolicies(train, val);
  assert.ok(r.nTrain === 60);
  assert.ok(r.bc.acc >= r.majority.acc);
});

test("confirmState gsi alive beats false menu cv", () => {
  const c = confirmState({ ok: true, screen: "MAIN_MENU", confidence: 0.9 }, { alive: true, inMenu: false });
  assert.equal(c.phase, "IN_GAME");
  assert.equal(c.gameplay_allowed, true);
});

test("readStack reads written stack.json", async () => {
  const { writeStack, readStack, DEFAULT_STACK } = await import("../brain-cfg.mjs");
  const s = readStack();
  for (const k of Object.keys(DEFAULT_STACK)) assert.equal(typeof s[k], "boolean");
  const next = writeStack({ fire: false });
  assert.equal(next.fire, false);
  assert.equal(readStack().fire, false);
  writeStack({ fire: true });
});

test("policy-router fsm vs missing pretrained", async () => {
  process.env.FARM_POLICY = "fsm";
  const { preferFromPolicy, stepsFromLabel, choosePrefer } = await import("../policy-router.mjs");
  const miss = preferFromPolicy({ id: "teapearce" });
  assert.equal(miss.ok, false);
  assert.equal(miss.reason, "pretrained-not-loaded");
  const bandit = preferFromPolicy({
    id: "bandit",
    weights: { k: { wait: { n: 3, v: 1 } } },
    key: "k",
    explore: 0,
    allow: ["wait"]
  });
  assert.equal(bandit.ok, true);
  assert.equal(bandit.action, "wait");
  assert.deepEqual(stepsFromLabel("walk-wd")[0], { action: "KEYDOWN", key: "W" });
  const fsm = choosePrefer({
    stack: { prompt: true, rules: true, rl: true, move: true },
    prompt: null,
    rules: "strafe-advance",
    weights: {},
    key: "x",
    explore: 0,
    allow: ["wait"]
  });
  assert.equal(fsm.action, "strafe-advance");
});

test("FARM_POLICY=bc does not silently use FSM", async () => {
  const { choosePrefer } = await import("../policy-router.mjs");
  const miss = choosePrefer({
    policyId: "bc",
    stack: { prompt: true, rules: true, rl: true, move: true },
    prompt: "strafe-advance",
    rules: "strafe-advance",
    weights: {},
    key: "x",
    explore: 0,
    allow: ["wait"],
    bcPredict: null,
    obs: { player: { alive: true, health: 100 }, radar: { self: { nx: 0.2, ny: 0.2 } } }
  });
  assert.equal(miss.source, "bc-fallback");
  assert.equal(miss.action, "wait");
  const hit = choosePrefer({
    policyId: "bc",
    stack: { prompt: true, rules: true, rl: true, move: true },
    prompt: "strafe-advance",
    rules: "strafe-advance",
    bcPredict: () => "walk-w",
    obs: { player: { alive: true } }
  });
  assert.equal(hit.source, "bc");
  assert.equal(hit.action, "walk-w");
});

test("bc predict ignores same-step keys", async () => {
  const { trainLinearBc } = await import("../bc.mjs");
  const obsA = {
    player: { alive: true, health: 100 },
    weapon: { ammo: 20 },
    radar: { wall_ahead: false, enemy_count: 0, self: { nx: 0.1, ny: 0.5 } },
    detections: [],
    round: { clock: "execute" }
  };
  const obsB = { ...obsA, radar: { ...obsA.radar, self: { nx: 0.9, ny: 0.5 } } };
  const train = [];
  for (let i = 0; i < 40; i++) {
    train.push({ observation: obsA, keys: { W: true, A: true }, action: "walk-wa" });
    train.push({ observation: obsB, keys: { W: true, D: true }, action: "walk-wd" });
  }
  const m = trainLinearBc(train, { steps: 50 });
  const a = m.predict({ observation: obsA, keys: { W: false } });
  const b = m.predict({ observation: obsB, keys: { W: false } });
  assert.equal(a, "walk-wa");
  assert.equal(b, "walk-wd");
});

test("dataset-adapter ego tick and episode split", async () => {
  const { fromEgoTick, checkRow, splitByEpisode } = await import("../dataset-adapter.mjs");
  const a = fromEgoTick({ w: 1, mouse_dx: 12, mouse_dy: 0, tick: 10, alive: true }, "ep1");
  assert.equal(a.action, "walk-w");
  assert.equal(a.keys.dx, 12);
  assert.equal(a.source, "egocs");
  const issues = checkRow({ timestamp: 1, keys: { dx: 1, dy: 1 }, action: "wait" }, null);
  assert.equal(issues.length, 0);
  const split = splitByEpisode([
    { episode_id: "a", timestamp: 1 },
    { episode_id: "b", timestamp: 1 },
    { episode_id: "c", timestamp: 1 }
  ]);
  assert.ok(split.train.length >= 1);
  assert.equal(split.episodes, 3);
});

test("pending bc is not active without confirm", async () => {
  delete process.env.FARM_POLICY;
  const { setPolicyId, activePolicyId, confirmPolicy } = await import("../policy-router.mjs");
  setPolicyId("bc");
  assert.equal(activePolicyId(), "fsm");
  confirmPolicy("fsm");
  assert.equal(activePolicyId(), "fsm");
});

test("dataset-qc flags empty session", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("fs");
  const { tmpdir } = await import("os");
  const { join } = await import("path");
  const { checkSession } = await import("../dataset-qc.mjs");
  const dir = mkdtempSync(join(tmpdir(), "qc-"));
  writeFileSync(join(dir, "frames.jsonl"), "");
  const r = checkSession(dir, "tmp");
  assert.equal(r.quarantine, true);
  assert.ok(r.reasons.includes("few-frames"));
  rmSync(dir, { recursive: true, force: true });
});

test("hierarchy walk vs aim", async () => {
  const { walkController, planSkill, runHierarchy } = await import("../skills/hierarchy.mjs");
  const w = walkController({ alive: true, wall_ahead: true, openRel: 30 }, { stuckMs: 0 });
  assert.equal(w.reason, "unstick");
  assert.ok(w.steps.some((s) => s.action === "LOOK"));
  const skill = planSkill({
    frame: { yolo: { dets: [{ name: "t", x: 20, y: 20 }] } },
    gsi: { team: "CT", alive: true, ammo: 10 }
  });
  assert.equal(skill, "aim");
  const run = runHierarchy({
    frame: { radar: { wall_ahead: false, self: { nx: 0.2, ny: 0.2 } }, yolo: { dets: [] }, mean: 40 },
    gsi: { alive: true, team: "CT" },
    force: "walk"
  });
  assert.equal(run.skill, "walk");
  assert.equal(run.decision.fsm, "skill");
});
