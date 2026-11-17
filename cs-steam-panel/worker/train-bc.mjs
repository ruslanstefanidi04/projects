// train linear BC on real human-record frames. not synthetic labels.
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { FARM_ROOT } from "./vm/defaults.mjs";
import { loadHumanDataset } from "./bc-data.mjs";
import { actionLabel, trainLinearBc, comparePolicies, saveBcModel, accuracy } from "./bc.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.FARM_BC_DIR || path.join(FARM_ROOT, "ops", "bc");
const MODEL = process.env.FARM_BC_MODEL || path.join(OUT, "model.json");

const data = loadHumanDataset();
if (!data.rows.length) {
  console.error("no human sessions with mixed actions");
  process.exit(1);
}
const { train, val, test, episodes } = data.split;
const steps = Number(process.env.FARM_BC_STEPS || 120);
const model = trainLinearBc(train, { steps, lr: 0.15 });
const cmp = comparePolicies(train, val.length ? val : train);
const testAcc = accuracy(test.length ? test : val, (r) => model.predict(r));
const counts = {};
for (const row of data.rows) {
  const a = actionLabel(row);
  counts[a] = (counts[a] || 0) + 1;
}
const extra = {
  trainedAt: new Date().toISOString(),
  dataset: {
    sessions: data.sessions,
    issues: data.issues,
    nRows: data.rows.length,
    nEpisodes: episodes,
    nTrain: train.length,
    nVal: val.length,
    nTest: test.length,
    labels: counts
  },
  train: { steps, lr: 0.15, kind: "linear-bc", balanced: false },
  metrics: { val: cmp, test: testAcc }
};
saveBcModel(model, MODEL, extra);
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, "train-report.json"), JSON.stringify(extra, null, 2));
saveBcModel(model, path.join(__dirname, "data", "bc-model.json"), extra);
console.log(JSON.stringify({ model: MODEL, ...extra.metrics, sessions: data.sessions.map((s) => s.id) }, null, 2));
