import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "fs";
import { createPid } from "../control/pid.mjs";
import { createKalman2d } from "../control/kalman2d.mjs";
import { astar, cellOf, emptyGrid, occFromRadar } from "../control/astar.mjs";
import { keysFromRel } from "../control/waypoint.mjs";
import { fireCommand } from "../control/fire.mjs";
import { strafeCommand } from "../control/strafe.mjs";
import { isFreshForAim } from "../control/freshness.mjs";
import { createClassicBrain, pickFoeDet } from "../control/classic.mjs";

test("pid pulls toward screen center", () => {
  const pid = createPid({ kp: 1, ki: 0, kd: 0, outLimit: 90 });
  const a = pid.update(20, -10, 0.05);
  assert.ok(a.dx > 0);
  assert.ok(a.dy < 0);
});

test("kalman tracks moving box", () => {
  const kf = createKalman2d();
  for (let i = 0; i < 12; i++) {
    kf.predict(0.05);
    kf.update(30 + i * 2, 40);
  }
  const s = kf.state();
  assert.ok(s.ok);
  assert.ok(s.x > 40);
  assert.ok(s.vx > 0);
});

test("astar goes around a wall on radar grid", () => {
  const g = emptyGrid(16);
  for (let y = 0; y < 16; y++) g[y][8] = 1;
  g[4][8] = 0;
  const path = astar(g, { x: 2, y: 8 }, { x: 14, y: 8 });
  assert.ok(path.length > 4);
  assert.ok(path.some((c) => c.y === 4));
});

test("occFromRadar uses self+facing not yolo wall boxes", () => {
  const occ = occFromRadar({
    n: 16,
    self: { nx: 0.5, ny: 0.5 },
    wall_ahead: true,
    facing_deg: 0
  });
  const c = cellOf(0.5, 0.5, 16);
  assert.equal(occ[c.y][c.x], 0);
  assert.equal(occ[c.y - 1][c.x], 1);
});

test("waypoint keys and strafe/fire contracts", () => {
  assert.deepEqual(keysFromRel(0, false).keys, ["W"]);
  assert.ok(keysFromRel(-30, false).keys.includes("A"));
  const st = strafeCommand({ wallAhead: true, openRel: -20, stuckMs: 0 });
  assert.equal(st.key, "A");
  assert.equal(fireCommand({ fresh: false, ammo: 10, err: 1 }).reason, "stale");
  assert.equal(fireCommand({ fresh: true, ammo: 10, err: 4 }).reason, "shot");
});

test("stale frame stops aim and fire", () => {
  const b = createClassicBrain();
  const frame = {
    age_ms: 5000,
    yolo: { dets: [{ name: "t", x: 20, y: 20 }] },
    radar: { wall_ahead: false, self: { nx: 0.2, ny: 0.2 } }
  };
  const out = b.tick({ frame, gsi: { alive: true, team: "CT", ammo: 20 }, force: "aim" });
  assert.equal(out.reason, "stale");
  assert.equal(out.steps.length, 0);
  assert.equal(isFreshForAim(frame), false);
});

test("fresh foe uses look, yolo does not choose walk", () => {
  const b = createClassicBrain();
  const walk = b.tick({
    frame: {
      age_ms: 40,
      yolo: { dets: [{ name: "wall", x: 50, y: 50 }] },
      radar: { wall_ahead: false, self: { nx: 0.2, ny: 0.2 }, facing_deg: 0 }
    },
    gsi: { alive: true, team: "CT", ammo: 20 },
    force: "walk"
  });
  assert.equal(walk.skill, "walk");
  assert.ok(!walk.steps.some((s) => s.action === "FIRE"));
  const aim = b.tick({
    frame: {
      age_ms: 40,
      yolo: { dets: [{ name: "t", x: 22, y: 30 }] },
      radar: { wall_ahead: false, self: { nx: 0.2, ny: 0.2 } }
    },
    gsi: { alive: true, team: "CT", ammo: 20 }
  });
  assert.ok(["aim", "fire"].includes(aim.skill));
  assert.equal(pickFoeDet([{ name: "wall" }, { name: "t", x: 1 }], "CT")?.name, "t");
});

test("controller latency on synthetic ticks", () => {
  const b = createClassicBrain();
  const t0 = performance.now();
  for (let i = 0; i < 800; i++) {
    b.tick({
      frame: {
        age_ms: 30,
        yolo: { dets: [{ name: "t", x: 40 + (i % 10), y: 40 }] },
        radar: {
          wall_ahead: i % 7 === 0,
          self: { nx: 0.2 + (i % 5) * 0.01, ny: 0.5 },
          facing_deg: 10,
          blocked: [{ nx: 0.4, ny: 0.5 }]
        }
      },
      gsi: { alive: true, team: "CT", ammo: 15 },
      route: { points: [{ nx: 0.8, ny: 0.5, zone: "a" }], plant: false }
    });
  }
  const ms = performance.now() - t0;
  assert.ok(ms < 250, "800 ticks " + ms + "ms");
});

test("yolo sequence on disk or synthetic boxes", () => {
  const kf = createKalman2d();
  let series = [
    { name: "t", x: 30, y: 40 },
    { name: "t", x: 34, y: 41 },
    { name: "t", x: 39, y: 40 }
  ];
  const think = "D:/FarmVMs/ops/vision/think-last.json";
  if (existsSync(think)) {
    try {
      const j = JSON.parse(readFileSync(think, "utf8"));
      const dets = j.yoloDets || j.yolo?.dets;
      if (Array.isArray(dets) && dets.length) series = dets;
    } catch {}
  }
  for (const d of series) {
    kf.predict(0.05);
    const n = String(d.name || d.cls || "");
    if (n === "t" || n === "th" || n === "c" || n === "ch") kf.update(d.x, d.y);
  }
  assert.ok(kf.state().x > 0);
});
