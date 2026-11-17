import { runDatasetQc } from "./dataset-qc.mjs";
const m = runDatasetQc();
console.log(JSON.stringify({ version: m.version, n: m.n, ok: m.ok, quarantine: m.quarantine.length, split: m.split }, null, 2));
