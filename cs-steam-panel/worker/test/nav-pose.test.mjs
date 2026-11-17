import test from "node:test";
import assert from "node:assert/strict";
import { readPose, poseMoved } from "../lab/pose.mjs";
import { loadMapGraph, graphPath, nearestNode } from "../nav/graph.mjs";

test("readPose rejects missing data", () => {
  const p = readPose({ gsi: {}, frame: {} });
  assert.equal(p.ok, false);
  assert.equal(p.reason, "no-pose");
});

test("readPose ignores stale dead gsi without map", () => {
  const p = readPose({
    gsi: { alive: false, health: 0 },
    frame: { radar: { self: { nx: 0.4, ny: 0.5 }, facing_ok: true, facing_deg: 40 } }
  });
  assert.equal(p.ok, true);
  assert.equal(p.nx, 0.4);
  assert.equal(p.yawOk, true);
});

test("readPose does not treat yaw 0 as ok without facing", () => {
  const p = readPose({
    gsi: { map: "de_mirage", alive: true },
    frame: { radar: { self: { nx: 0.4, ny: 0.4 }, facing_deg: 0, facing_ok: false } }
  });
  assert.equal(p.ok, true);
  assert.equal(p.yawOk, false);
  assert.equal(p.yaw, null);
});

test("poseMoved uses world delta", () => {
  assert.equal(poseMoved({ x: 0, y: 0 }, { x: 20, y: 0 }), true);
  assert.equal(poseMoved({ x: 0, y: 0 }, { x: 1, y: 0 }), false);
});

test("mirage graph t spawn to a", () => {
  const g = loadMapGraph("de_mirage");
  const ids = graphPath(g, "t_spawn", "a");
  assert.ok(ids.includes("t_spawn"));
  assert.ok(ids.includes("a"));
  assert.ok(ids.length >= 2);
});

test("dust2 graph t spawn to long a", () => {
  const g = loadMapGraph("de_dust2");
  const ids = graphPath(g, "t_spawn", "long_a");
  assert.deepEqual(ids, ["t_spawn", "long_doors", "long_a"]);
  const near = nearestNode(g, { nx: 0.52, ny: 0.86 });
  assert.equal(near.node.id, "t_spawn");
});
