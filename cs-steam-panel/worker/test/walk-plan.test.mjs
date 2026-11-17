import test from "node:test";
import assert from "node:assert/strict";
import { planWalk, stepsFromPlan, selfOnRadar } from "../lab/walk-plan.mjs";

test("planWalk needs self on radar", () => {
  const r = planWalk({
    frame: { radar: { wall_ahead: false } },
    gsi: { map: "de_mirage" },
    goal: { nx: 0.8, ny: 0.5 }
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, "Нет данных");
});

test("planWalk uses nav graph on mirage", () => {
  const r = planWalk({
    frame: { radar: { wall_ahead: false, self: { nx: 0.82, ny: 0.45 } } },
    gsi: { map: "de_mirage", forward: { x: 1, y: 0, z: 0 } },
    goal: { nx: 0.48, ny: 0.68 }
  });
  assert.equal(r.ok, true);
  assert.equal(r.source, "nav-graph");
  assert.ok(r.path.length >= 2);
  assert.equal(r.path[0].id, "t_spawn");
});

test("stepsFromPlan look when facing known", () => {
  const steps = stepsFromPlan({ ok: true, rel: 120, reason: "ok", faceOk: true });
  const look = steps.find((s) => s.action === "LOOK");
  assert.ok(look);
  assert.ok(Math.abs(look.dx) >= 80);
  assert.ok(steps.some((s) => s.action === "HOLD" && s.key === "W"));
});

test("stepsFromPlan no look without facing", () => {
  const steps = stepsFromPlan({ ok: true, rel: 120, reason: "ok" });
  assert.equal(steps.some((s) => s.action === "LOOK"), false);
  assert.ok(steps.some((s) => s.action === "HOLD" && s.key === "W"));
});

test("selfOnRadar ignores 0,0 placeholder", () => {
  assert.equal(selfOnRadar({ radar: { self: { nx: 0, ny: 0 } } }, {}), null);
  assert.equal(selfOnRadar({ radar: { self: { nx: 0.31, ny: 0.4 } } }, {}).source, "radar");
});

test("planWalk uses occupancy walls", () => {
  const occupancy = Array.from({ length: 32 }, () => Array(32).fill(0));
  for (let y = 0; y < 32; y++) occupancy[y][16] = 255;
  const blocked = planWalk({
    frame: { radar: { self: { nx: 0.2, ny: 0.5 }, occupancy } },
    goal: { nx: 0.8, ny: 0.5 }
  });
  assert.equal(blocked.ok, false);
  const occupancy2 = Array.from({ length: 32 }, () => Array(32).fill(0));
  for (let y = 20; y < 32; y++) occupancy2[y][16] = 255;
  const open = planWalk({
    frame: { radar: { self: { nx: 0.2, ny: 0.2 }, occupancy: occupancy2 } },
    goal: { nx: 0.8, ny: 0.2 }
  });
  assert.equal(open.ok, true);
});
