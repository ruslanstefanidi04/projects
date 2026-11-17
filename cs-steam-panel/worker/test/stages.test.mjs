import test from "node:test";
import assert from "node:assert/strict";
import { defaultStages, mergeStages } from "../lab/stages.mjs";

test("default current stage is walk, none marked ready", () => {
  const d = defaultStages();
  assert.equal(d.currentId, "walk");
  assert.equal(d.stages.length, 6);
  assert.ok(d.stages.every((s) => s.status !== "Готово"));
  assert.equal(d.stages.find((s) => s.id === "walk").status, "В работе");
  assert.equal(d.stages.find((s) => s.id === "aim").status, "Не начато");
});

test("ready status without verified tests is rejected", () => {
  const m = mergeStages({
    currentId: "walk",
    stages: [{ id: "walk", status: "Готово", verified: [], lastResult: "fake" }]
  });
  assert.notEqual(m.stages.find((s) => s.id === "walk").status, "Готово");
});
