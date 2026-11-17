import { AGENT_PORT, FARM_ROOT, GOLDEN_NAME, MEM_MAX_MB, MEM_MIN_MB, MEM_STARTUP_MB, SWITCH_NAME } from "./defaults.mjs";
import { hyperVReady, isolationMode, slotState, vmScriptsPresent } from "./host.mjs";
import { checkHost } from "./ensure-host.mjs";
import { spawnSync } from "child_process";

function listVms() {
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "Get-VM -ErrorAction SilentlyContinue | Select-Object Name,State,@{n='MemMB';e={[int]($_.MemoryAssigned/1MB)}} | ConvertTo-Json -Compress"
    ],
    { encoding: "utf8", windowsHide: true, timeout: 20000 }
  );
  const raw = String(r.stdout || "").trim();
  if (!raw) return [];
  try {
    const j = JSON.parse(raw);
    return Array.isArray(j) ? j : [j];
  } catch {
    return [];
  }
}

const mode = isolationMode();
const ready = hyperVReady();
const scripts = vmScriptsPresent();
const host = checkHost();
const vms = ready ? listVms() : [];
const golden = vms.find((v) => String(v.Name) === GOLDEN_NAME);

console.log(
  JSON.stringify(
    {
      mode,
      allowCs: process.env.FARM_ALLOW_CS === "1",
      hyperV: ready,
      scripts,
      hostOk: host.ok,
      hostIssues: host.issues,
      agent: host.agent,
      nat: host.nat,
      root: FARM_ROOT,
      switch: SWITCH_NAME,
      golden: golden || host.goldenVm || null,
      memPlanMb: { min: MEM_MIN_MB, start: MEM_STARTUP_MB, max: MEM_MAX_MB },
      agentPort: AGENT_PORT,
      vms
    },
    null,
    2
  )
);

if (process.argv[2]) {
  console.log("slot", slotState(process.argv[2]));
}

process.exit(host.ok ? 0 : 2);
