// queue jobs for CSFarmHostOps (SYSTEM). no UAC from worker.
import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { FARM_ROOT } from "./defaults.mjs";

const OPS = path.join(FARM_ROOT, "ops");
const RUN = path.join(OPS, "run.ps1");
const OUT = path.join(OPS, "see-out.txt");
const VIEW = path.join(OPS, "view.png");
const CONSOLE_PS = path.join(FARM_ROOT, "vm-console.ps1");

function ensureOps() {
  mkdirSync(OPS, { recursive: true });
}

export function opsPaths() {
  return { ops: OPS, run: RUN, out: OUT, view: VIEW, consolePs: CONSOLE_PS };
}

export function queueHostOps(psBody, { clearOut = true } = {}) {
  ensureOps();
  if (clearOut && existsSync(OUT)) {
    try {
      unlinkSync(OUT);
    } catch {}
  }
  const script = String(psBody || "").trim();
  if (!script) throw new Error("empty host ops body");
  writeFileSync(RUN, script.endsWith("\n") ? script : script + "\n", "utf8");
  spawnSync("schtasks", ["/Run", "/TN", "CSFarmHostOps"], { windowsHide: true, encoding: "utf8" });
  return { run: RUN, out: OUT };
}

export async function waitHostOps({ marker = "DONE", timeoutMs = 120000, pollMs = 2000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (existsSync(OUT)) {
      const text = readFileSync(OUT, "utf8");
      if (text.includes(marker)) return text;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  const partial = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  throw new Error("host ops timeout: " + (partial.slice(-500) || "no output"));
}

export async function runHostOps(psBody, opts = {}) {
  queueHostOps(psBody, opts);
  return waitHostOps(opts);
}

export async function guestPs(scriptBlockBody, {
  farmUser = "farm",
  farmPass = "FarmPass1!",
  vmName = process.env.FARM_GOLDEN || "csfarm-golden",
  timeoutMs = 180000
} = {}) {
  const body = `
$ErrorActionPreference = "Continue"
$out = "${OUT.replace(/\\/g, "\\\\")}"
"" | Set-Content $out
Import-Module Hyper-V
$cred = New-Object PSCredential("${farmUser}",(ConvertTo-SecureString "${farmPass}" -AsPlainText -Force))
$s = New-PSSession -VMName "${vmName}" -Credential $cred
try {
  $r = Invoke-Command -Session $s -ScriptBlock {
${scriptBlockBody}
  }
  "GUEST $($r | ConvertTo-Json -Depth 6 -Compress)" | Set-Content $out
} catch {
  "GUEST_ERR $($_.Exception.Message)" | Set-Content $out
} finally {
  Remove-PSSession $s -EA SilentlyContinue
}
"DONE" | Add-Content $out
`;
  return runHostOps(body, { marker: "DONE", timeoutMs });
}

export async function guestProcs() {
  const text = await guestPs(`
  $all = Get-Process -EA SilentlyContinue | Where-Object { $_.ProcessName -match 'steam|cs2|node' } |
    Select-Object Id,ProcessName,@{n='MB';e={[math]::Round($_.WorkingSet64/1MB,1)}}
  [pscustomobject]@{
    hasCs2 = [bool](Get-Process cs2 -EA SilentlyContinue)
    hasSteam = [bool](Get-Process steam -EA SilentlyContinue)
    procs = @($all)
    at = (Get-Date -Format o)
  }
`);
  const m = text.match(/GUEST (.+)\r?\nDONE/s);
  if (!m) return { raw: text };
  try {
    return JSON.parse(m[1]);
  } catch {
    return { raw: m[1] };
  }
}
