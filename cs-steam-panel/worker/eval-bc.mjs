// offline eval: FSM-rules vs saved BC on held-out human episodes. not live cs2.
import { writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import { FARM_ROOT } from "./vm/defaults.mjs";
import { loadHumanDataset } from "./bc-data.mjs";
import { loadBcModel, actionLabel, accuracy, majorityBaseline } from "./bc.mjs";
import { choosePrefer } from "./policy-router.mjs";
import { preferByRules } from "./play-policy.mjs";

const MODEL = process.env.FARM_BC_MODEL || path.join(FARM_ROOT, "ops", "bc", "model.json");
const OUT = path.join(FARM_ROOT, "ops", "eval");

const data = loadHumanDataset();
const model = loadBcModel(MODEL);
if (!model) {
  console.error("no model", MODEL);
  process.exit(1);
}
const { test, val, train } = data.split;
const hold = test.length ? test : val.length ? val : train;

function gsiFromObs(obs) {
  return {
    alive: obs?.player?.alive !== false,
    health: obs?.player?.health,
    team: obs?.player?.team,
    ammo: obs?.weapon?.ammo,
    inMenu: false,
    map: obs?.round?.map,
    clock: obs?.round?.clock
  };
}

function timePreds(rows, pred) {
  const t0 = Date.now();
  let n = 0;
  for (const row of rows) {
    pred(row);
    n += 1;
  }
  const ms = Date.now() - t0;
  return { n, total_ms: ms, per_ms: n ? ms / n : 0 };
}

process.env.FARM_POLICY = "bc";
const bcPredict = (row) => model.predict(row);
let bcDirect = 0;
let bcFallback = 0;
const preds = [];
const tInf = Date.now();
for (const row of hold) {
  const picked = choosePrefer({
    policyId: "bc",
    stack: { prompt: true, rules: true, rl: true, move: true },
    prompt: "strafe-advance",
    rules: preferByRules(gsiFromObs(row.observation)),
    weights: {},
    key: "eval",
    explore: 0,
    allow: ["wait"],
    bcPredict,
    obs: row.observation
  });
  if (picked.source === "bc") bcDirect += 1;
  else bcFallback += 1;
  preds.push({ y: actionLabel(row), pred: picked.action, source: picked.source });
}
const infMs = Date.now() - tInf;

process.env.FARM_POLICY = "fsm";
let fsmWalk = 0;
let fsmWait = 0;
for (const row of hold) {
  const r = preferByRules(gsiFromObs(row.observation)) || "strafe-advance";
  if (String(r).includes("walk") || r === "strafe-advance") fsmWalk += 1;
  else fsmWait += 1;
}

const bcAcc = accuracy(hold, (r) => model.predict(r));
const maj = majorityBaseline(train.length ? train : hold);
const majAcc = accuracy(hold, () => maj.action);
const walkHuman = hold.filter((r) => actionLabel(r).startsWith("walk-"));
const walkHit = walkHuman.filter((r) => String(model.predict(r)).startsWith("walk-")).length;
const scenario = {
  name: "heldout-walk-not-idle",
  human_walk_rows: walkHuman.length,
  bc_also_walk: walkHit,
  success: walkHuman.length > 0 && walkHit / walkHuman.length >= 0.3
};
const lat = timePreds(hold, (r) => model.predict(r));

const report = {
  at: new Date().toISOString(),
  live_cs2: false,
  model: MODEL,
  nHold: hold.length,
  bc: {
    acc: bcAcc,
    majority: majAcc,
    decisions_from_model: bcDirect,
    fallback: bcFallback,
    share_model: hold.length ? bcDirect / hold.length : 0,
    inference_ms_total: infMs,
    inference_ms_per: lat.per_ms
  },
  fsm_rules: { walkish: fsmWalk, other: fsmWait },
  scenario,
  load_and_act: {
    name: "heldout-model-emits-action",
    success: hold.length > 0 && bcDirect === hold.length && typeof model.predict(hold[0]) === "string"
  },
  stuck_proxy: {
    human_wait: hold.filter((r) => actionLabel(r) === "wait").length,
    bc_wait: preds.filter((p) => p.pred === "wait").length
  }
};
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, "bc-vs-fsm.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.load_and_act.success) process.exitCode = 2;
