import { existsSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { AGENT_PORT, AGENT_TOKEN, FARM_ROOT, GOLDEN_NAME } from "./defaults.mjs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function ps(cmd, timeout = 20000) {
  const r = spawnSync("powershell", ["-NoProfile", "-Command", cmd], {
    encoding: "utf8",
    windowsHide: true,
    timeout
  });
  return { status: r.status || 0, out: String(r.stdout || "").trim(), err: String(r.stderr || "").trim() };
}

function httpGet(url, timeoutMs = 4000) {
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `$ErrorActionPreference='Stop'; try { $r=Invoke-WebRequest -UseBasicParsing -Uri '${url}' -TimeoutSec ${Math.max(1, Math.ceil(timeoutMs / 1000))}; $r.Content } catch { Write-Output ('ERR:' + $_.Exception.Message); exit 1 }`
    ],
    { encoding: "utf8", windowsHide: true, timeout: timeoutMs + 3000 }
  );
  const out = String(r.stdout || "").trim();
  if (r.status) return { ok: false, error: out.replace(/^ERR:/, "") || r.stderr || "request fail" };
  try {
    return { ok: true, data: JSON.parse(out) };
  } catch {
    return { ok: true, data: { raw: out } };
  }
}

export function bestFarmRootHint() {
  const r = ps(`
$vols = Get-Volume | Where-Object { $_.DriveLetter -and $_.SizeRemaining -gt 40GB }
if (-not $vols) { ''; exit 0 }
$best = $vols | Where-Object { $_.DriveLetter -ne 'C' } | Sort-Object SizeRemaining -Descending | Select-Object -First 1
if (-not $best) { $best = $vols | Sort-Object SizeRemaining -Descending | Select-Object -First 1 }
Write-Output ($best.DriveLetter + ':\\FarmVMs')
`);
  return r.out || "D:\\FarmVMs";
}

function goldenIpCandidates(root) {
  const fixed = String(process.env.FARM_GOLDEN_IP || "").trim();
  if (fixed) return [fixed];
  // convention: golden first-boot uses SlotOctet 10
  const ips = ["10.250.0.10"];
  const hv = ps(
    `(Get-VMNetworkAdapter -VMName '${GOLDEN_NAME}' -ErrorAction SilentlyContinue | ForEach-Object { $_.IPAddresses }) -join ','`
  );
  for (const part of String(hv.out || "").split(",")) {
    const ip = part.trim();
    if (ip && !ip.includes(":") && ip !== "0.0.0.0" && !ips.includes(ip)) ips.unshift(ip);
  }
  return ips;
}

export function pingGoldenAgent(root = process.env.FARM_VM_ROOT || FARM_ROOT) {
  const ips = goldenIpCandidates(root);
  let last = "no attempt";
  for (const ip of ips) {
    const ping = httpGet(`http://${ip}:${AGENT_PORT}/ping`, 3500);
    if (ping.ok && ping.data && ping.data.ok) {
      const status = httpGet(`http://${ip}:${AGENT_PORT}/status?token=${encodeURIComponent(AGENT_TOKEN)}`, 4000);
      return {
        ok: true,
        ip,
        ping: ping.data,
        status: status.ok ? status.data : { ok: false, error: status.error }
      };
    }
    last = ping.error || "ping fail";
  }
  return { ok: false, ip: ips[0] || null, error: last, tried: ips };
}

export function checkHost() {
  const issues = [];
  const hints = [];
  const root = process.env.FARM_VM_ROOT || FARM_ROOT;
  const drive = String(root).slice(0, 2);
  if (!existsSync(drive + "\\")) {
    issues.push(`farm disk missing: ${drive}`);
    hints.push(`run setup-farm.bat (picks disk, writes worker\\.env)`);
  } else if (!existsSync(root)) {
    issues.push(`FARM_VM_ROOT missing: ${root}`);
    hints.push("run setup-farm.bat");
  }
  const hv = ps("Get-Command Get-VM -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name");
  if (!hv.out.includes("Get-VM")) {
    issues.push("Hyper-V PowerShell missing");
    hints.push("run setup-farm.bat as admin (may need reboot)");
  }
  const iso = process.env.FARM_ISO || path.join(root, "iso", "Win10_22H2_English_x64.iso");
  const pro = path.join(root, "iso", "pro.wim");
  if (!existsSync(iso) && !existsSync(pro)) {
    issues.push("no Win10 ISO/pro.wim");
    hints.push("setup-farm.bat downloads them to FarmVMs\\iso");
  }
  const goldenVhd = path.join(root, GOLDEN_NAME, `${GOLDEN_NAME}.vhdx`);
  if (!existsSync(goldenVhd) || (existsSync(goldenVhd) && statSync(goldenVhd).size < 1_000_000_000)) {
    issues.push("golden OS not applied yet (empty/small vhdx)");
    hints.push("setup-farm.bat or apply-golden.bat");
  }
  if (!existsSync(path.join(repoRoot, "worker", "node_modules"))) {
    issues.push("worker/node_modules missing");
    hints.push("cd worker && npm install  (or setup-farm.bat)");
  }

  const nodeZip = path.join(root, "cache", "node-v22.19.0-win-x64.zip");
  if (!existsSync(nodeZip) || statSync(nodeZip).size < 1_000_000) {
    issues.push("portable node zip missing in FarmVMs\\cache");
    hints.push("setup-farm / push-node downloads node for offline guest inject");
  }

  const nat = ps("Get-NetNat -Name csfarm-nat -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name");
  const natOk = nat.out.includes("csfarm-nat");
  if (!natOk) {
    // non-fatal for agent on internal switch, but steam download needs it
    hints.push("optional: enable csfarm-nat (push-node.bat / setup-farm) for guest internet");
  }

  let goldenVm = null;
  const vmLine = ps(
    `$vm=Get-VM -Name '${GOLDEN_NAME}' -ErrorAction SilentlyContinue; if($vm){ Write-Output ($vm.State.ToString() + '|' + [int]($vm.MemoryAssigned/1MB)) }`
  );
  if (vmLine.out) {
    const [state, mem] = vmLine.out.split("|");
    goldenVm = { name: GOLDEN_NAME, state, memMb: Number(mem) || 0 };
    if (String(state).toLowerCase() !== "running") {
      issues.push(`golden VM not Running (state=${state})`);
      hints.push("Start-VM csfarm-golden or apply-golden.bat");
    }
  } else if (hv.out.includes("Get-VM")) {
    // Get-VM exists but query failed (often non-admin token) - do not hard-fail if agent answers
    hints.push("Hyper-V query needs admin for full VM list; agent ping still checked");
  }

  const agent = pingGoldenAgent(root);
  if (!agent.ok) {
    issues.push(`golden guest-agent down (${agent.ip || "?"}:${AGENT_PORT}): ${agent.error}`);
    hints.push("run D:\\FarmVMs\\push-node.bat as admin (injects node + starts agent)");
  } else if (agent.status && agent.status.ok === false) {
    issues.push(`golden agent auth/status fail: ${agent.status.error || "status"}`);
    hints.push("align FARM_AGENT_TOKEN in worker\\.env with guest run-agent.cmd");
  } else {
    const steam =
      (agent.status && agent.status.steam && agent.status.steam.installed) ||
      agent.ping?.steam === true;
    const cs2 =
      (agent.status && agent.status.steam && agent.status.steam.cs2Manifest) ||
      agent.ping?.cs2 === true;
    agent.steam = !!steam;
    agent.cs2 = !!cs2;
    if (!steam) {
      issues.push("golden Steam not installed");
      hints.push("run worker\\vm\\install-steam-golden.ps1 as admin (or D:\\FarmVMs\\install-steam.bat)");
    } else if (!cs2) {
      // warn only: CS seed is a later golden step, do not block worker boot
      hints.push("golden has Steam but no CS2 yet; seed/library before cloning slots");
    }
  }

  return {
    ok: issues.length === 0,
    root,
    iso,
    proWim: pro,
    nat: natOk,
    goldenVm,
    agent,
    issues,
    hints: [...new Set(hints)],
    suggestRoot: bestFarmRootHint()
  };
}

export function printHostCheck() {
  const c = checkHost();
  console.log("host check", c.ok ? "ok" : "NEED SETUP");
  console.log("farm root", c.root, "suggest", c.suggestRoot);
  if (c.goldenVm) console.log("golden vm", c.goldenVm.state, c.goldenVm.memMb + "MB");
  if (c.agent && c.agent.ok) {
    console.log(
      "golden agent",
      c.agent.ip,
      c.agent.ping?.host || "",
      "allowCs=" + String(c.agent.ping?.allowCs),
      "steam=" + String(c.agent.steam),
      "cs2=" + String(c.agent.cs2)
    );
    if (c.agent.status && c.agent.status.ok) {
      console.log("agent status mem", JSON.stringify(c.agent.status.mem || {}));
    }
  }
  console.log("nat", c.nat ? "ok" : "missing");
  for (const i of c.issues) console.log(" -", i);
  for (const h of c.hints) console.log("hint", h);
  return c;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("ensure-host.mjs")) {
  const c = printHostCheck();
  process.exit(c.ok ? 0 : 2);
}
