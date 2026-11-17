import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import {
  AGENT_PORT,
  AGENT_TOKEN,
  DISK_GB,
  FARM_ROOT,
  GOLDEN_NAME,
  MEM_MAX_MB,
  MEM_MIN_MB,
  MEM_STARTUP_MB,
  SWITCH_NAME,
  VCPU,
  slotName
} from "./defaults.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function psFile(name) {
  return path.join(here, name);
}

function runPs(scriptPath, args = [], timeout = 120000) {
  const r = spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args],
    { encoding: "utf8", windowsHide: true, timeout }
  );
  const out = String(r.stdout || "").trim();
  const err = String(r.stderr || "").trim();
  if (out) console.log(out.split(/\r?\n/).slice(-8).join(" | "));
  if (r.status && r.status !== 0) {
    const msg = err || out || `ps exit ${r.status}`;
    throw new Error(msg);
  }
  return out;
}

function runPsCmd(command, timeout = 60000) {
  const r = spawnSync("powershell", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
    timeout
  });
  return {
    status: r.status || 0,
    out: String(r.stdout || "").trim(),
    err: String(r.stderr || "").trim()
  };
}

export function isolationMode() {
  const v = String(process.env.FARM_ISOLATION || "vm").toLowerCase();
  // host = hyped-farm path: real GPU on host (CS2Farmer-style). vm needs working GPU-PV.
  if (v === "host" || v === "native" || v === "gpu") return "host";
  if (v === "sandbox" || v === "sandboxie") {
    throw new Error("sandbox retired; use FARM_ISOLATION=host (GPU) or vm (GPU-PV)");
  }
  return "vm";
}

export function hyperVReady() {
  const r = runPsCmd("Get-Command Get-VM -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name");
  return r.out.includes("Get-VM");
}

export function enableHyperV() {
  return runPs(psFile("enable-hyperv.ps1"), [], 300000);
}

export function createGoldenShell(iso = process.env.FARM_ISO || "") {
  const args = [
    "-Name",
    GOLDEN_NAME,
    "-Root",
    FARM_ROOT,
    "-Switch",
    SWITCH_NAME,
    "-DiskGB",
    String(DISK_GB),
    "-StartupMB",
    String(MEM_STARTUP_MB),
    "-MinMB",
    String(MEM_MIN_MB),
    "-MaxMB",
    String(MEM_MAX_MB),
    "-Cpu",
    String(VCPU)
  ];
  if (iso) args.push("-Iso", iso);
  return runPs(psFile("new-golden.ps1"), args, 180000);
}

export function ensureSlot(acc, { start = false } = {}) {
  const name = slotName(acc);
  const args = [
    "-Slot",
    name,
    "-Golden",
    GOLDEN_NAME,
    "-Root",
    FARM_ROOT,
    "-Switch",
    SWITCH_NAME,
    "-StartupMB",
    String(MEM_STARTUP_MB),
    "-MinMB",
    String(MEM_MIN_MB),
    "-MaxMB",
    String(MEM_MAX_MB),
    "-Cpu",
    String(VCPU)
  ];
  if (start) args.push("-Start");
  const out = runPs(psFile("new-slot.ps1"), args, 180000);
  return { name, out };
}

export function startSlot(acc) {
  const name = slotName(acc);
  const r = runPsCmd(`if ((Get-VM -Name '${name}').State -eq 'Off') { Start-VM -Name '${name}'; 'started' } else { 'running' }`);
  if (r.status) throw new Error(r.err || r.out || "start fail");
  console.log("vm start", name, r.out);
  return name;
}

export function stopSlot(acc) {
  const name = slotName(acc);
  const r = runPsCmd(
    `$vm = Get-VM -Name '${name}' -ErrorAction SilentlyContinue; if (-not $vm) { 'missing' } elseif ($vm.State -eq 'Off') { 'off' } else { Stop-VM -Name '${name}' -Force; 'stopped' }`
  );
  console.log("vm stop", name, r.out || r.err);
  return name;
}

export function slotState(acc) {
  const name = slotName(acc);
  const r = runPsCmd(
    `$vm = Get-VM -Name '${name}' -ErrorAction SilentlyContinue; if (-not $vm) { 'missing' } else { $vm.State.ToString() + ' mem=' + [int]($vm.MemoryAssigned/1MB) + 'MB' }`
  );
  return { name, state: r.out || "error", err: r.err };
}

function guestIps(name) {
  const r = runPsCmd(
    `(Get-VMNetworkAdapter -VMName '${name}' -ErrorAction SilentlyContinue | ForEach-Object { $_.IPAddresses }) -join ','`
  );
  return String(r.out || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !s.includes(":") && s !== "0.0.0.0");
}

function playOnGolden() {
  return process.env.FARM_PLAY_ON_GOLDEN === "1" || process.env.FARM_PLAY_ON_GOLDEN === "true";
}

function goldenFallbackIp() {
  return String(process.env.FARM_GOLDEN_IP || "10.250.0.10").trim() || "10.250.0.10";
}

export function resolveVmName(acc) {
  if (playOnGolden()) return GOLDEN_NAME;
  return slotName(acc);
}

async function fetchAgent(ip, route, { method = "GET", body, timeoutMs = 30000 } = {}) {
  const url = `http://${ip}:${AGENT_PORT}${route}`;
  const r = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${AGENT_TOKEN}`,
      "content-type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await r.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!r.ok) throw new Error(data.error || `agent ${r.status}`);
  return data;
}

export async function waitAgent(acc, ms = 120000) {
  const name = resolveVmName(acc);
  const t0 = Date.now();
  let last = "";
  while (Date.now() - t0 < ms) {
    const ips = guestIps(name);
    if (playOnGolden() && !ips.includes(goldenFallbackIp())) ips.unshift(goldenFallbackIp());
    for (const ip of ips) {
      try {
        const data = await fetchAgent(ip, "/ping");
        if (data && data.ok) {
          console.log("vm agent", name, ip);
          return { name, ip, data };
        }
      } catch (e) {
        last = String(e.message || e);
      }
    }
    last = last || ("no ip yet: " + (ips.join(",") || "none"));
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`agent timeout ${name}: ${last}`);
}

export async function agentRequest(acc, route, opts = {}) {
  const name = resolveVmName(acc);
  const ips = guestIps(name);
  if (playOnGolden() && !ips.includes(goldenFallbackIp())) ips.unshift(goldenFallbackIp());
  if (!ips.length) throw new Error("guest has no ip yet: " + name);
  const timeoutMs = /\/steam\/launch|\/cs\/launch/.test(route) ? 180000 : 30000;
  let last = "";
  for (const ip of ips) {
    try {
      return { name, ip, data: await fetchAgent(ip, route, { ...opts, timeoutMs }) };
    } catch (e) {
      last = String(e.message || e);
    }
  }
  throw new Error(last || "agent fail");
}

export async function prepareVmAccount(acc) {
  const name = resolveVmName(acc);
  if (playOnGolden()) {
    console.log("vm play on golden", name);
    const agent = await waitAgent(acc, Number(process.env.FARM_AGENT_WAIT_MS || 180000) || 180000);
    const prep = await agentRequest(acc, "/prepare", { method: "POST", body: { login: acc.login || "" } });
    return {
      vm: true,
      name: agent.name,
      ip: agent.ip,
      cs: false,
      pid: null,
      session: {},
      agent: prep.data,
      note: "golden ready"
    };
  }
  if (!hyperVReady()) {
    throw new Error("нет Hyper-V PowerShell. Запусти setup-hyperv.bat от админа и перезагрузись");
  }
  const goldenPs = runPsCmd(`Get-VM -Name '${GOLDEN_NAME}' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name`);
  if (!goldenPs.out.includes(GOLDEN_NAME)) {
    throw new Error(`нет golden VM '${GOLDEN_NAME}'. Сначала new-golden + установка Win10 внутри`);
  }
  ensureSlot(acc, { start: true });
  startSlot(acc);
  const st = slotState(acc);
  console.log("vm state", st.name, st.state);
  const agent = await waitAgent(acc, Number(process.env.FARM_AGENT_WAIT_MS || 180000) || 180000);
  const prep = await agentRequest(acc, "/prepare", { method: "POST", body: { login: acc.login || "" } });
  return {
    vm: true,
    name: agent.name,
    ip: agent.ip,
    cs: false,
    pid: null,
    session: {},
    agent: prep.data,
    note: "vm ready"
  };
}

export async function launchVmGame(acc, opts = {}) {
  const ready = await prepareVmAccount(acc);
  const q = opts.queue || { kind: "competitive", host: "" };
  const netcon = Number(opts.netconPort) || 21234;
  let steamUp = false;
  try {
    const ping = await agentRequest(acc, "/ping");
    const procs = ping.data?.procs || [];
    steamUp = procs.some((p) => /^steam$/i.test(String(p)));
  } catch {}
  const keepSteam = opts.keepSteam === true || (steamUp && opts.restart === false) || (steamUp && opts.skipLogin);
  const body = {
    login: acc.login || "",
    password: acc.password || "",
    guard: opts.guard || "",
    farmUser: process.env.FARM_GUEST_USER || "farm",
    farmPass: process.env.FARM_GUEST_PASS || "FarmPass1!",
    session: keepSteam ? {} : acc.steamSession || {},
    queueKind: q.kind || "competitive",
    connectHost: q.host || "",
    gsiHost: process.env.GSI_HOST || "10.250.0.1",
    gsiPort: Number(process.env.BOT_GSI_PORT || 32222),
    gsiToken: process.env.BOT_GSI_TOKEN || "csfarm",
    netconPort: netcon,
    fps: acc.fpsCap || 20,
    restart: keepSteam ? false : opts.restart !== false,
    keepSteam,
    skipLogin: keepSteam
  };
  const route = keepSteam ? "/cs/run" : "/steam/launch";
  let launched;
  try {
    launched = await agentRequest(acc, route, { method: "POST", body });
  } catch (e) {
    if (keepSteam && /unknown|404/i.test(String(e.message || e))) {
      launched = await agentRequest(acc, "/steam/launch", { method: "POST", body });
    } else {
      throw e;
    }
  }
  return {
    vm: true,
    name: ready.name,
    ip: ready.ip,
    cs: Boolean(launched.data?.hasCs || launched.data?.ok),
    pid: launched.data?.pid || null,
    session: {},
    netcon,
    agent: launched.data,
    note: `vm ${route} ${q.kind}${keepSteam ? " keepSteam" : ""}`
  };
}

export function vmScriptsPresent() {
  return ["enable-hyperv.ps1", "new-golden.ps1", "new-slot.ps1", "guest-agent.mjs"].every((f) =>
    existsSync(path.join(here, f))
  );
}
