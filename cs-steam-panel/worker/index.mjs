import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DEFAULT_STEAM, installGsi, killPid, launchCs2, launchSteam, queueTarget, steamRootFromExe, waitCsInBox, writeQueue } from "./launch.mjs";
import { sandboxBox, harvestSession, boxHasCs, boxHasCsWindow, stopBox, sessionIsLive, shotCsWindow } from "./sandbox.mjs";
import { steamUiGuard } from "./steam-login.mjs";
import { gates, sleepJitter } from "./pace.mjs";
import { acceptIncoming, parseTradeUrl, sendToVault } from "./trade.mjs";
import { botNote, setAutoMatch, setBotEnabled, setBotHooks, startBot } from "./bot.mjs";
import { stillWarm, stepWarmup, warmupCsCount, warmupNote } from "./warmup.mjs";
import { setInputBox } from "./input.mjs";
import { queueMatch } from "./macros.mjs";
import { isolationMode, stopSlot, agentRequest } from "./vm/host.mjs";
import { printHostCheck } from "./vm/ensure-host.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadDotenv() {
  for (const rel of [".env.local", "worker/.env", ".env"]) {
    const p = path.join(root, rel);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

loadDotenv();
try {
  if (isolationMode() === "vm") printHostCheck();
} catch (e) {
  console.error(String(e.message || e));
}

function pickTestAcc(accounts) {
  const want = String(process.env.WORKER_AUTO_TEST_LOGIN || "").toLowerCase();
  if (want) {
    const hit = accounts.find((a) => String(a.login).toLowerCase() === want);
    if (hit) return hit;
  }
  return accounts.find((a) => a.testOnly) || accounts[0];
}

async function accCsLive(acc) {
  if (isolationMode() === "vm") {
    try {
      const r = await agentRequest(acc, "/status");
      const procs = r.data?.procs || [];
      return procs.some((p) => /^cs2$/i.test(String(p)));
    } catch {
      return liveIds.has(acc.id);
    }
  }
  const box = sandboxBox(acc);
  return boxHasCs(box) || boxHasCsWindow(box);
}

function localAccPath() {
  return path.join(root, "worker", "sess", "local-accs.json");
}

function loadLocalAccs() {
  try {
    const j = JSON.parse(readFileSync(localAccPath(), "utf8"));
    return Array.isArray(j) ? j.filter((a) => a && a.id && String(a.login || "").trim()) : [];
  } catch {
    return [];
  }
}

function saveLocalAccs(list) {
  try {
    mkdirSync(path.dirname(localAccPath()), { recursive: true });
    const prev = new Map(loadLocalAccs().map((x) => [x.id, x]));
    const slim = list.map((a) => {
      const old = prev.get(a.id);
      const sess = sessionIsLive(a.steamSession) ? a.steamSession : sessionIsLive(old?.steamSession) ? old.steamSession : {};
      return {
        id: a.id,
        login: a.login,
        password: a.password,
        email: a.email || "",
        testOnly: a.testOnly !== false,
        steamId: a.steamId || "",
        steamPath: a.steamPath || "",
        sharedSecret: a.sharedSecret || "",
        identitySecret: a.identitySecret || "",
        matchKind: a.matchKind || "competitive",
        steamSession: sess
      };
    });
    writeFileSync(localAccPath(), JSON.stringify(slim, null, 2));
  } catch (e) {
    console.error("local acc save", e.message || e);
  }
}

function restorePayload(list) {
  return list.map((a) => ({
    id: a.id,
    login: a.login,
    password: a.password,
    email: a.email,
    testOnly: a.testOnly,
    steamId: a.steamId,
    steamPath: a.steamPath,
    sharedSecret: a.sharedSecret,
    identitySecret: a.identitySecret,
    steamSession: a.steamSession,
    matchKind: a.matchKind
  }));
}

const PANEL = (process.env.PANEL_URL || "http://localhost:3000").replace(/\/$/, "");
const TOKEN = process.env.WORKER_TOKEN || "";
const pids = new Map();
let lastBeat = 0;
const pendingLaunch = [];
const liveIds = new Set();
const launching = new Set();
let accountsRef = [];
let autoTest = process.env.WORKER_AUTO_TEST === "1";
let testMatches = 0;
let lastAutoQueue = 0;
const testNeed = Math.max(1, Number(process.env.WORKER_TEST_DM || 2) || 2);
let settingsRef = { autoMatch: true, batchSize: 5, passTarget: 14, proxyPerGroup: 5 };
const gsiPort = Number(process.env.BOT_GSI_PORT || 32222);
startBot(gsiPort, process.env.BOT_GSI_TOKEN || "csfarm");
try {
  installGsi(steamRootFromExe(process.env.STEAM_EXE || DEFAULT_STEAM));
} catch {}

function findAcc(steamId) {
  if (steamId) {
    const hit = accountsRef.find((a) => a.steamId && a.steamId === steamId);
    if (hit) return hit;
  }
  return accountsRef.find((a) => liveIds.has(a.id)) || accountsRef[0];
}

setBotHooks({
  onMatchEnd: async ({ steamId }) => {
    const acc = findAcc(steamId);
    testMatches += 1;
    console.log("match end", testMatches, "/", acc?.testOnly ? testNeed : (settingsRef.passTarget || "-"));
    if (!acc) return;
    if (acc.testOnly) {
      await report(acc, { status: "queued", passMatches: testMatches });
      if (testMatches >= testNeed) console.log("test dm done", testMatches);
      return;
    }
    if (stillWarm(acc)) return;
    const matches = (acc.passMatches || 0) + 1;
    const target = Number(settingsRef.passTarget) || 0;
    const done = target > 0 && matches >= target;
    acc.passMatches = matches;
    acc.passDone = done;
    await report(acc, {
      passMatches: matches,
      passDone: done,
      status: done ? "idle" : "queued"
    });
    if (done && !settingsRef.cycleRunning) {
      await sleepJitter(5000, 11000);
      const cur = pids.get(acc.id);
      killPid(cur?.steam);
      liveIds.delete(acc.id);
      await report(acc, { status: "idle", pidSteam: null });
    }
  },
  onNeedQueue: async ({ steamId }) => {
    if (settingsRef.autoMatch === false) return;
    const acc = findAcc(steamId);
    if (!acc || acc.passDone || acc.rewardsClaimed) return;
    if (stillWarm(acc)) return;
    const exe = acc.steamPath || process.env.STEAM_EXE || DEFAULT_STEAM;
    const q = queueTarget(acc, "");
    writeQueue(steamRootFromExe(exe), acc.steamId, q.kind, q.host, sandboxBox(acc));
    setInputBox(sandboxBox(acc));
    await queueMatch();
    await report(acc, { status: "queued" });
  }
});

async function api(method, body) {
  await sleepJitter(80, 420);
  const r = await fetch(`${PANEL}/api/worker/sync`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json"
    },
    body: method === "GET" ? undefined : JSON.stringify(body || {})
  });
  if (r.status === 429) {
    await sleepJitter(15000, 35000);
    throw new Error("panel 429");
  }
  if (!r.ok) throw new Error(`panel ${r.status}`);
  return r.json();
}

async function waitCsWindow(box, ms = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (boxHasCsWindow(box) || boxHasCs(box)) {
      console.log("cs2 window", box);
      return true;
    }
    console.log("wait cs2 window", box);
    await sleepJitter(2500, 4000);
  }
  return boxHasCs(box);
}

async function report(acc, patch) {
  await api("POST", {
    accounts: [
      {
        id: acc.id,
        workerAt: Date.now(),
        ...patch
      }
    ]
  });
}

async function pushQueue(box, steamRoot, acc, q) {
  writeQueue(steamRoot, acc.steamId, q.kind, q.host, box);
  setInputBox(box);
  console.log("menu queue", acc.login, q.kind);
  await waitCsWindow(box, 120000);
  const shot = path.join(root, "worker", "sess", "tmp-cs.png");
  shotCsWindow(box, shot);
  for (let i = 0; i < 8; i++) {
    console.log("box menu click", i + 1);
    await queueMatch();
    shotCsWindow(box, shot);
    await sleepJitter(1500, 2500);
  }
}

function vaultUrl(settings, cmd) {
  return (cmd.payload || settings.vaultTradeUrl || "").trim();
}

async function handle(acc, cmd, settings, accounts, opts = {}) {
  const exe = acc.steamPath || process.env.STEAM_EXE || DEFAULT_STEAM;
  const steamRoot = steamRootFromExe(exe);
  await gates.command.take();
  try {
    if (cmd.kind === "launch") {
      if (!opts.test && isolationMode() !== "vm" && !(acc.proxy || "").trim()) {
        await report(acc, { status: "error", lastError: "нет прокси" });
        return;
      }
      if (!opts.test) await gates.launch.take();
      await sleepJitter(800, 2600);
      console.log("cmd", cmd.kind, acc.login, "test", Boolean(opts.test), "pass", Boolean(acc.password), "guard", Boolean(acc.sharedSecret));
      await report(acc, { status: "starting", lastError: "" });
      const q = queueTarget(acc, cmd.payload);
      const wantQueue =
        opts.test ||
        (!opts.skipAutoQueue &&
          settings.autoMatch !== false &&
          !settings.cycleRunning &&
          !acc.passDone &&
          !acc.rewardsClaimed);
      const launched = await launchSteam(acc, liveIds.size, wantQueue ? { queue: q } : {});
      if (launched && launched.vm) {
        liveIds.add(acc.id);
        gates.launch.ok();
        if (launched.cs) {
          await report(acc, {
            status: "queued",
            pidSteam: launched.pid,
            pidCs: null,
            lastError: "",
            matchKind: (wantQueue ? q.kind : acc.matchKind) || "competitive"
          });
          console.log("vm cs up", launched.name, launched.ip);
        } else {
          await report(acc, {
            status: "steam",
            pidSteam: null,
            pidCs: null,
            lastError: launched.note || `vm ${launched.name} @ ${launched.ip}, cs off`
          });
          console.log("vm slot ready, no cs", launched.name, launched.ip);
        }
        return;
      }
      const pid = launched && typeof launched === "object" ? launched.pid : launched;
      pids.set(acc.id, { steam: pid, cs: null });
      const patch = { status: "cs2", pidSteam: pid, fpsCap: acc.fpsCap || 20 };
      if (launched && launched.session && Object.keys(launched.session).length) {
        patch.steamSession = launched.session;
        acc.steamSession = launched.session;
      }
      await report(acc, patch);
      liveIds.add(acc.id);
      gates.launch.ok();
      if (wantQueue) {
        const box = sandboxBox(acc);
        console.log("queue after launch", acc.login, q.kind, "cs", Boolean(launched && launched.cs));
        if (launched && launched.cs) {
          await pushQueue(box, steamRoot, acc, q);
          await report(acc, { status: "queued", lastError: "" });
        } else {
          await report(acc, { status: "cs2", lastError: "CS ещё грузится. Когда меню, жми Поиск" });
        }
      }
      return;
    }
    if (cmd.kind === "stop") {
      await sleepJitter(200, 900);
      const cur = pids.get(acc.id);
      killPid(cur?.steam);
      killPid(cur?.cs);
      if (isolationMode() === "vm") {
        try {
          await agentRequest(acc, "/stop", { method: "POST", body: {} });
        } catch (e) {
          console.log("vm stop agent", String(e.message || e));
        }
        if (process.env.FARM_PLAY_ON_GOLDEN !== "1") stopSlot(acc);
      } else stopBox(sandboxBox(acc), exe);
      pids.delete(acc.id);
      liveIds.delete(acc.id);
      await report(acc, { status: "idle", pidSteam: null, pidCs: null });
      return;
    }
    if (cmd.kind === "guard") {
      const box = sandboxBox(acc);
      const ok = await steamUiGuard({ ...acc, box }, cmd.payload);
      console.log("guard", acc.login, ok ? "ok" : "fail");
      await sleepJitter(8000, 12000);
      const session = harvestSession(box, steamRoot);
      if (Object.keys(session).length) {
        acc.steamSession = session;
        await report(acc, { steamSession: session, lastError: ok ? "" : "guard fail" });
      }
      return;
    }
    if (cmd.kind === "queue" || cmd.kind === "connect") {
      if (isolationMode() === "vm") {
        await gates.queue.take();
        await sleepJitter(600, 2000);
        const q = queueTarget(acc, cmd.payload);
        console.log("vm queue", acc.login, q.kind);
        try {
          const { agentRequest } = await import("./vm/host.mjs");
          const { setConBox, setConHost, netconPort, conExec } = await import("./con.mjs");
          const { setInputAgent } = await import("./input.mjs");
          const boxKey = "";
          const ready = await agentRequest(acc, "/queue", {
            method: "POST",
            body: {
              queueKind: q.kind,
              connectHost: q.host || "",
              gsiHost: process.env.GSI_HOST || "10.250.0.1",
              gsiPort: Number(process.env.BOT_GSI_PORT || 32222),
              gsiToken: process.env.BOT_GSI_TOKEN || "csfarm",
              fps: acc.fpsCap || 20
            }
          });
          setConBox(boxKey);
          setConHost(ready.ip);
          setInputAgent(ready.ip, process.env.FARM_AGENT_TOKEN || "csfarm");
          await conExec("exec farm_queue");
          await conExec("farmgo");
          await report(acc, { status: cmd.kind === "connect" ? "ingame" : "queued", lastError: "" });
        } catch (e) {
          await report(acc, { status: "error", lastError: String(e.message || e) });
        }
        gates.queue.ok();
        return;
      }
      await gates.queue.take();
      await sleepJitter(600, 2000);
      const q = queueTarget(acc, cmd.payload);
      const box = sandboxBox(acc);
      console.log("queue", acc.login, q.kind);
      writeQueue(steamRoot, acc.steamId, q.kind, q.host, box);
      if (!boxHasCs(box)) {
        console.log("queue: no cs2, applaunch");
        launchCs2(acc);
        const up = await waitCsInBox(box, 120000);
        if (!up) {
          console.log("queue: cs2 still missing");
          await report(acc, { status: "cs2", lastError: "CS ещё не встал, Steam крутит загрузку" });
          gates.queue.ok();
          return;
        }
      }
      await pushQueue(box, steamRoot, acc, q);
      await report(acc, { status: cmd.kind === "connect" ? "ingame" : "queued", lastError: "" });
      gates.queue.ok();
      return;
    }
    if (cmd.kind === "refresh") {
      await sleepJitter(200, 800);
      await report(acc, { status: acc.status || "idle" });
      return;
    }
    if (cmd.kind === "sendVault") {
      const url = vaultUrl(settings, cmd);
      if (!url) throw new Error("vault trade url empty");
      const parsed = parseTradeUrl(url);
      if (acc.steamId && parsed.steamId && acc.steamId === parsed.steamId) {
        await report(acc, { tradeNote: "skip self" });
        return;
      }
      await report(acc, { status: "trading", lastError: "", tradeNote: "send" });
      const res = await sendToVault(acc, url);
      await report(acc, {
        status: "idle",
        lastTradeAt: Date.now(),
        tradeNote: `sent ${res.sent} ${res.status}`
      });
      return;
    }
    if (cmd.kind === "acceptTrades") {
      const allow = accounts.map((a) => a.steamId).filter(Boolean);
      if (settings.vaultSteamId) allow.push(settings.vaultSteamId);
      const parsed = parseTradeUrl(settings.vaultTradeUrl || "");
      if (parsed.steamId) allow.push(parsed.steamId);
      await report(acc, { status: "trading", lastError: "", tradeNote: "accept" });
      const res = await acceptIncoming(acc, allow);
      await report(acc, {
        status: "idle",
        lastTradeAt: Date.now(),
        tradeNote: `accepted ${res.accepted}`
      });
    }
  } catch (e) {
    await report(acc, { status: "error", lastError: String(e.message || e) });
  }
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

function cmdOf(kind, acc) {
  return { id: kind + acc.id, accountId: acc.id, kind, payload: "", createdAt: Date.now() };
}

let cycleBusy = false;
let cycleFlag = false;
let cycleMsg = "";

async function stopIds(ids, settings, accounts) {
  for (const id of ids) {
    const acc = accountsRef.find((a) => a.id === id);
    if (!acc) continue;
    await handle(acc, cmdOf("stop", acc), settings || settingsRef, accounts || accountsRef);
    await sleepJitter(350, 1100);
  }
}

function proxyKey(a) {
  return (a.proxyId || a.proxy || "").trim();
}

async function runCycleWave() {
  const settings = settingsRef;
  const per = Math.max(1, Math.min(5, Number(settings.proxyPerGroup || settings.batchSize) || 5));
  const pool = accountsRef.filter((a) => a.enabled && !a.testOnly && !a.passDone && !a.rewardsClaimed && proxyKey(a) && !stillWarm(a));
  const unbound = accountsRef.filter((a) => a.enabled && !a.testOnly && !a.passDone && !a.rewardsClaimed && !proxyKey(a) && !stillWarm(a));
  if (!pool.length) {
    const warming = accountsRef.filter((a) => a.enabled && !a.testOnly && stillWarm(a)).length;
    const note = warming ? "все в прогреве" : unbound.length ? "нет привязанных прокси" : "недельный пасс закрыт";
    await api("POST", { settings: { cycleRunning: false, botNote: note } });
    cycleMsg = note;
    settingsRef.cycleRunning = false;
    return;
  }
  const groups = new Map();
  for (const a of pool) {
    const k = proxyKey(a);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  }
  const keys = shuffle([...groups.keys()]);
  const wave = (groups.get(keys[0]) || []).slice(0, per);
  const startMarks = Object.fromEntries(wave.map((a) => [a.id, a.passMatches || 0]));
  await api("POST", { settings: { botNote: `пачка ${wave.length}: ${wave.map((a) => a.login).join(", ")}` } });
  cycleMsg = `пачка ${wave.length}`;
  for (const acc of wave) {
    if (!settingsRef.cycleRunning) return;
    await handle(acc, cmdOf("launch", acc), settingsRef, accountsRef, { skipAutoQueue: true });
    await sleepJitter(3500, 8000);
  }
  await sleepJitter(7000, 14000);
  for (const acc of wave) {
    if (!settingsRef.cycleRunning) return;
    await handle(acc, cmdOf("queue", acc), settingsRef, accountsRef);
    await sleepJitter(1200, 3200);
  }
  const deadline = Date.now() + 50 * 60 * 1000;
  while (Date.now() < deadline && settingsRef.cycleRunning) {
    await sleepJitter(9000, 16000);
    const allDone = wave.every((w) => {
      const a = accountsRef.find((x) => x.id === w.id);
      if (!a) return true;
      if (a.passDone || a.rewardsClaimed) return true;
      return (a.passMatches || 0) > (startMarks[w.id] || 0);
    });
    if (allDone) break;
  }
  await api("POST", { settings: { botNote: "мешаем пачку" } });
  cycleMsg = "мешаем пачку";
  await stopIds(wave.map((a) => a.id), settingsRef, accountsRef);
  await sleepJitter(15000, 35000);
}

async function maybeCycle() {
  if (!settingsRef.cycleRunning || cycleBusy) return;
  cycleBusy = true;
  try {
    await runCycleWave();
  } catch (e) {
    console.error(e.message || e);
    await sleepJitter(8000, 16000);
  }
  cycleBusy = false;
}

async function drainLaunches(settings, accounts) {
  const size = Math.max(1, Math.min(5, Number(settings.proxyPerGroup || settings.batchSize) || 5));
  while (pendingLaunch.length && liveIds.size < size) {
    const item = pendingLaunch.shift();
    if (!item) break;
    const acc = item.acc;
    if (acc.rewardsClaimed || acc.passDone || liveIds.has(acc.id)) continue;
    if (acc.testOnly || stillWarm(acc)) continue;
    if (!(acc.proxy || "").trim()) continue;
    await sleepJitter(12000, 28000);
    await handle(acc, item.cmd, settings, accounts);
  }
}

let warmBusy = false;

async function maybeWarmup() {
  if (warmBusy) return;
  warmBusy = true;
  try {
    await stepWarmup({
      accounts: accountsRef,
      settings: settingsRef,
      api,
      launchSteam,
      killPid,
      liveIds,
      pids,
      cycleRunning: Boolean(settingsRef.cycleRunning)
    });
  } catch (e) {
    console.error(e.message || e);
  }
  warmBusy = false;
}

async function tick() {
  if (!TOKEN) {
    console.error("WORKER_TOKEN missing");
    return;
  }
  const data = await api("GET");
  let accounts = data.accounts || [];
  const settings = data.settings || {};
  if (!accounts.length) {
    const seed = accountsRef.length ? accountsRef : loadLocalAccs();
    if (seed.length) {
      console.log("panel accs 0, restore", seed.map((a) => a.login).join(","));
      await api("POST", { accounts: restorePayload(seed) });
      accounts = seed;
      accountsRef = seed;
      saveLocalAccs(seed);
    }
  } else {
    const prev = new Map(accountsRef.map((a) => [a.id, a]));
    for (const a of accounts) {
      const old = prev.get(a.id);
      if (old?.steamSession && Object.keys(old.steamSession).length) {
        if (!a.steamSession || !Object.keys(a.steamSession).length) a.steamSession = old.steamSession;
      }
      if (old?.password && !a.password) a.password = old.password;
    }
    accountsRef = accounts;
  }
  if (accounts.length) {
    const disk = loadLocalAccs();
    const byLogin = new Map(disk.map((a) => [String(a.login).toLowerCase(), a]));
    for (const a of accounts) {
      const hit = byLogin.get(String(a.login).toLowerCase());
      if (hit?.password && !a.password) a.password = hit.password;
    }
    saveLocalAccs(accounts);
  }
  if (autoTest && accounts.length && testMatches < testNeed) {
    const acc = pickTestAcc(accounts);
    if (acc && !launching.has(acc.id)) {
      if (!acc.matchKind) acc.matchKind = "competitive";
      const csUp = await accCsLive(acc);
      if (csUp) {
        liveIds.add(acc.id);
        if (Date.now() - lastAutoQueue >= 20000) {
          lastAutoQueue = Date.now();
          console.log("auto test queue again", acc.login, testMatches, "/", testNeed, botNote());
          launching.add(acc.id);
          handle(acc, { kind: "queue", payload: "" }, settings, accounts, { test: true }).finally(() => launching.delete(acc.id));
        }
      } else if (liveIds.has(acc.id)) {
        console.log("auto test wait cs2", acc.login, botNote());
      } else {
        console.log("auto test", acc.login, "matches", testMatches, "/", testNeed, "pass", Boolean(acc.password));
        launching.add(acc.id);
        handle(acc, { kind: "launch", payload: "" }, settings, accounts, { test: true }).finally(() => launching.delete(acc.id));
      }
    }
  }
  settingsRef = settings;
  setBotEnabled(settings.botEnabled !== false);
  setAutoMatch(settings.autoMatch !== false && !warmupCsCount());
  maybeWarmup();
  if (settings.cycleRunning) {
    cycleFlag = true;
    maybeCycle();
  } else if (cycleFlag) {
    cycleFlag = false;
    cycleMsg = "";
    await stopIds([...liveIds], settings, accounts);
  }
  const cmds = [...(data.commands || [])].sort((a, b) => Number(a.kind !== "stop") - Number(b.kind !== "stop"));
  console.log("poll accs", accounts.length, "cmds", cmds.length || "-", cmds.map((c) => c.kind).join(",") || "none");
  const byId = new Map(accounts.map((a) => [a.id, a]));
  for (const cmd of cmds) {
    const acc = byId.get(cmd.accountId);
    if (!acc) continue;
    if (cmd.kind === "guard") {
      await handle(acc, cmd, settings, accounts);
      continue;
    }
    if (settings.cycleRunning) continue;
    if (cmd.kind === "test") {
      if (launching.has(acc.id)) {
        console.log("skip dup test", acc.login);
        continue;
      }
      if (!acc.matchKind) acc.matchKind = "competitive";
      if (liveIds.has(acc.id) && (await accCsLive(acc))) {
        console.log("already live, queue", acc.login);
        await handle(acc, { ...cmd, kind: "queue" }, settings, accounts, { test: true });
        continue;
      }
      launching.add(acc.id);
      handle(acc, { ...cmd, kind: "launch" }, settings, accounts, { test: true }).finally(() => launching.delete(acc.id));
      continue;
    }
    if (cmd.kind === "launch") {
      if (acc.rewardsClaimed || acc.passDone) continue;
      if (stillWarm(acc) || acc.testOnly) continue;
      if (!(acc.proxy || "").trim()) continue;
      pendingLaunch.push({ acc, cmd });
      continue;
    }
    await sleepJitter(400, 1600);
    await handle(acc, cmd, settings, accounts);
  }
  if (!settings.cycleRunning) await drainLaunches(settings, accounts);
  const now = Date.now();
  if (now - lastBeat < 8000) return;
  lastBeat = now;
  await gates.heartbeat.take();
  await api("POST", {
    settings: { botNote: cycleMsg || warmupNote() || botNote() }
  });
  gates.heartbeat.ok();
}

async function localTrainingTick() {
  if (!autoTest || testMatches >= testNeed) return;
  const accounts = accountsRef.length ? accountsRef : loadLocalAccs();
  if (!accounts.length) return;
  accountsRef = accounts;
  const acc = pickTestAcc(accounts);
  if (!acc || launching.has(acc.id)) return;
  if (!acc.matchKind) acc.matchKind = "competitive";
  const csUp = await accCsLive(acc);
  if (!csUp) {
    if (liveIds.has(acc.id)) return;
    if (isolationMode() !== "vm") {
      console.log("local train, no cs2 yet");
      return;
    }
    if (Date.now() - lastAutoQueue < 60000) return;
    lastAutoQueue = Date.now();
    console.log("local train launch", acc.login, "pass", Boolean(acc.password));
    launching.add(acc.id);
    handle(acc, { kind: "launch", payload: "" }, settingsRef, accounts, { test: true }).finally(() => launching.delete(acc.id));
    return;
  }
  if (Date.now() - lastAutoQueue < 8000) return;
  lastAutoQueue = Date.now();
  liveIds.add(acc.id);
  console.log("local train queue", acc.login);
  launching.add(acc.id);
  handle(acc, { kind: "queue", payload: "" }, settingsRef, accounts, { test: true }).finally(() => launching.delete(acc.id));
}

async function loop() {
  console.log("worker boot ui-login", new Date().toISOString());
  console.log("worker ->", PANEL);
  while (true) {
    try {
      await localTrainingTick();
      await gates.poll.take();
      await tick();
      gates.poll.ok();
    } catch (e) {
      gates.poll.bump();
      console.error(e.message || e);
      try {
        await localTrainingTick();
      } catch (e2) {
        console.error(e2.message || e2);
      }
      await sleepJitter(2500, 5000);
    }
  }
}

loop();
