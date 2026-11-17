// majority vs linear softmax BC on traj rows. no extra ml package.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

export const FEATURE_NAMES = [
  "alive",
  "health",
  "ammo",
  "nx",
  "ny",
  "wall_ahead",
  "enemy_count",
  "dets",
  "clock_freeze",
  "clock_execute",
  "clock_planted",
  "mean",
  "team_t"
];

export function encodeObs(obs) {
  const p = obs?.player || {};
  const w = obs?.weapon || {};
  const r = obs?.radar || {};
  const self = r.self || {};
  const clock = String(obs?.round?.clock || "");
  return [
    p.alive ? 1 : 0,
    Number(p.health || 0) / 100,
    Number(w.ammo || 0) / 30,
    Number(self.nx || 0),
    Number(self.ny || 0),
    r.wall_ahead ? 1 : 0,
    Math.min(1, Number(r.enemy_count || 0) / 5),
    Math.min(1, (obs?.detections || []).length / 8),
    clock === "freeze" ? 1 : 0,
    clock === "execute" ? 1 : 0,
    clock === "planted" ? 1 : 0,
    Math.min(1, Number(obs?.screenshot?.mean ?? obs?.mean ?? 40) / 160),
    String(p.team || "").toUpperCase().startsWith("T") && !String(p.team || "").includes("CT") ? 1 : 0
  ];
}

export function actionLabel(row) {
  const a = String(row?.action || "wait");
  if (a.startsWith("walk-") || a === "wait" || a === "idle") return a === "idle" ? "wait" : a;
  if (a === "fire") return "fire";
  return "wait";
}

export function balanceRows(rows) {
  const by = new Map();
  for (const row of rows || []) {
    const a = actionLabel(row);
    if (!by.has(a)) by.set(a, []);
    by.get(a).push(row);
  }
  let m = 0;
  for (const list of by.values()) if (list.length > m) m = list.length;
  if (!m) return [];
  const out = [];
  for (const list of by.values()) {
    for (let i = 0; i < m; i++) out.push(list[i % list.length]);
  }
  return out;
}

export function majorityBaseline(rows) {
  const c = new Map();
  for (const row of rows || []) {
    const a = actionLabel(row);
    c.set(a, (c.get(a) || 0) + 1);
  }
  let best = "wait";
  let n = -1;
  for (const [k, v] of c) {
    if (v > n) {
      n = v;
      best = k;
    }
  }
  return { kind: "majority", action: best, counts: Object.fromEntries(c) };
}

export function accuracy(rows, predict) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return { n: 0, acc: 0 };
  let ok = 0;
  for (const row of list) {
    if (predict(row) === actionLabel(row)) ok += 1;
  }
  return { n: list.length, acc: ok / list.length };
}

function softmax(logits) {
  const m = Math.max(...logits);
  const e = logits.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0) || 1;
  return e.map((x) => x / s);
}

export function trainLinearBc(trainRows, { steps = 40, lr = 0.2 } = {}) {
  const labels = [...new Set((trainRows || []).map(actionLabel))];
  if (!labels.includes("wait")) labels.push("wait");
  const dim = encodeObs(trainRows?.[0]?.observation).length;
  const k = labels.length;
  const W = Array.from({ length: k }, () => Array(dim).fill(0));
  for (let s = 0; s < steps; s++) {
    for (const row of trainRows || []) {
      const x = encodeObs(row.observation);
      const y = labels.indexOf(actionLabel(row));
      const logits = W.map((w) => w.reduce((a, b, i) => a + b * x[i], 0));
      const p = softmax(logits);
      for (let c = 0; c < k; c++) {
        const g = p[c] - (c === y ? 1 : 0);
        for (let i = 0; i < dim; i++) W[c][i] -= lr * g * x[i];
      }
    }
  }
  return wrapLinearBc({ kind: "linear-bc", labels, W });
}

export function wrapLinearBc({ labels, W, kind = "linear-bc" }) {
  return {
    kind,
    labels,
    W,
    predict(row) {
      const x = encodeObs(row.observation);
      const logits = W.map((w) => w.reduce((a, b, i) => a + b * x[i], 0));
      let bi = 0;
      for (let i = 1; i < logits.length; i++) if (logits[i] > logits[bi]) bi = i;
      return labels[bi];
    }
  };
}

export function loadBcModel(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  const j = JSON.parse(readFileSync(filePath, "utf8"));
  if (!Array.isArray(j?.W) || !Array.isArray(j?.labels)) return null;
  return wrapLinearBc(j);
}

export function saveBcModel(model, filePath, extra = {}) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const body = {
    kind: model.kind || "linear-bc",
    labels: model.labels,
    W: model.W,
    features: FEATURE_NAMES,
    ...extra
  };
  writeFileSync(filePath, JSON.stringify(body), "utf8");
  return filePath;
}

export function comparePolicies(trainRows, valRows) {
  const maj = majorityBaseline(trainRows);
  const bc = trainLinearBc(trainRows);
  const majAcc = accuracy(valRows, () => maj.action);
  const bcAcc = accuracy(valRows, (r) => bc.predict(r));
  return { majority: majAcc, bc: bcAcc, labels: bc.labels, nTrain: trainRows.length, nVal: valRows.length };
}
