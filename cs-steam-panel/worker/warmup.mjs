import { createRequire } from "module";
import { steamGuard } from "./totp.mjs";
import { steamUserProxy } from "./proxy.mjs";
import { gates, jitter, sleepJitter } from "./pace.mjs";

const require = createRequire(import.meta.url);
const SteamUser = require("steam-user");

const FREE_APPS = [440, 570, 304930, 444090, 238960, 230410, 291550, 236390, 1172470, 218230];
const idle = new Map();
const failUntil = new Map();
const csUntil = new Map();
let lastSwitch = 0;

export function stillWarm(a) {
  if (!a || a.testOnly || a.warmupDone) return false;
  const until = Number(a.warmupUntil) || 0;
  if (!until) return false;
  return Date.now() < until;
}

function dayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rollDayMs() {
  const r = Math.random();
  if (r < 0.12) return jitter(6.2 * 3600000, 8 * 3600000);
  if (r < 0.4) return jitter(3.4 * 3600000, 5.6 * 3600000);
  return jitter(1.7 * 3600000, 3.1 * 3600000);
}

function pickApp() {
  return FREE_APPS[Math.floor(Math.random() * FREE_APPS.length)];
}

function logOff(id) {
  const s = idle.get(id);
  if (!s) return;
  try {
    s.client.gamesPlayed([]);
    s.client.logOff();
  } catch {}
  idle.delete(id);
}

function waitLogged(client) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("warmup login timeout")), 50000);
    const fail = (e) => {
      clearTimeout(t);
      reject(e);
    };
    client.once("error", fail);
    client.once("loggedOn", () => {
      clearTimeout(t);
      client.removeListener("error", fail);
      resolve();
    });
  });
}

function freeLicense(client, ids) {
  return new Promise((resolve) => {
    try {
      client.requestFreeLicense(ids, (err, granted) => {
        resolve(err ? [] : granted || []);
      });
    } catch {
      resolve([]);
    }
  });
}

function ensureDay(acc) {
  const day = dayKey();
  if (acc.warmupDay === day && acc.warmupDayTarget) return acc;
  acc.warmupDay = day;
  acc.warmupDayMs = 0;
  acc.warmupDayTarget = Math.floor(rollDayMs());
  return acc;
}

function needHours(acc) {
  ensureDay(acc);
  return acc.warmupDayMs < acc.warmupDayTarget;
}

function csDue(acc) {
  const created = Number(acc.createdAt) || Date.now();
  if (Date.now() < created + jitter(36 * 3600000, 62 * 3600000)) return false;
  const last = Number(acc.lastCsWarmAt) || 0;
  const gap = 3 * 86400000 + jitter(-10 * 3600000, 12 * 3600000);
  return Date.now() - last >= gap;
}

async function startIdle(acc, api) {
  if (failUntil.get(acc.id) > Date.now()) return;
  if (!(acc.proxy || "").trim()) return;
  await gates.login.take();
  const client = new SteamUser({
    autoRelogin: false,
    dataDirectory: null,
    ...steamUserProxy(acc.proxy)
  });
  const code = steamGuard(acc.sharedSecret);
  const opts = { accountName: acc.login, password: acc.password };
  if (code) opts.twoFactorCode = code;
  try {
    client.logOn(opts);
    await waitLogged(client);
    gates.login.ok();
    client.setPersona(SteamUser.EPersonaState.Online);
    await sleepJitter(800, 2400);
    let licensed = Boolean(acc.warmupLicensed);
    if (!licensed) {
      await freeLicense(client, FREE_APPS);
      licensed = true;
    }
    const app = pickApp();
    client.gamesPlayed(app);
    idle.set(acc.id, { client, app, at: Date.now(), beat: Date.now() });
    await api("POST", {
      accounts: [
        {
          id: acc.id,
          warmupLicensed: licensed,
          warmupDay: acc.warmupDay,
          warmupDayMs: acc.warmupDayMs,
          warmupDayTarget: acc.warmupDayTarget,
          status: "idleplay",
          lastError: "",
          warmupNote: `idle ${app}`
        }
      ]
    });
  } catch (e) {
    gates.login.bump();
    failUntil.set(acc.id, Date.now() + jitter(25 * 60000, 55 * 60000));
    try {
      client.logOff();
    } catch {}
    await api("POST", {
      accounts: [{ id: acc.id, status: "error", lastError: String(e.message || e), warmupNote: "idle fail" }]
    });
  }
}

export async function stepWarmup(ctx) {
  const { accounts, settings, api, launchSteam, killPid, liveIds, pids, cycleRunning } = ctx;
  if (settings.warmupEnabled === false) {
    for (const id of [...idle.keys()]) logOff(id);
    return;
  }
  const patches = [];
  const now = Date.now();
  for (const acc of accounts) {
    if (!stillWarm(acc) && acc.warmupUntil && !acc.warmupDone) {
      patches.push({ id: acc.id, warmupDone: true, warmupNote: "прогрев закрыт", status: "idle" });
      logOff(acc.id);
    }
  }
  for (const [id, until] of [...csUntil.entries()]) {
    if (now < until) continue;
    csUntil.delete(id);
    const cur = pids.get(id);
    killPid(cur?.steam);
    killPid(cur?.cs);
    pids.delete(id);
    liveIds.delete(id);
    patches.push({ id, status: "idle", pidSteam: null, pidCs: null, warmupNote: "cs час закрыт" });
  }
  for (const [id, s] of [...idle.entries()]) {
    const acc = accounts.find((a) => a.id === id);
    if (!acc || !stillWarm(acc) || !needHours(acc)) {
      logOff(id);
      if (acc) patches.push({ id, status: "idle", warmupNote: "норма дня" });
      continue;
    }
    const add = now - (s.beat || now);
    s.beat = now;
    acc.warmupDayMs = (acc.warmupDayMs || 0) + add;
    if (now - lastSwitch > jitter(18 * 60000, 42 * 60000)) {
      lastSwitch = now;
      const app = pickApp();
      try {
        s.client.gamesPlayed(app);
        s.app = app;
      } catch {}
      const st = [SteamUser.EPersonaState.Online, SteamUser.EPersonaState.LookingToPlay, SteamUser.EPersonaState.Away];
      try {
        s.client.setPersona(st[Math.floor(Math.random() * st.length)]);
      } catch {}
    }
    if (now - s.at > jitter(55 * 60000, 95 * 60000)) logOff(id);
    else {
      patches.push({
        id,
        warmupDay: acc.warmupDay,
        warmupDayMs: acc.warmupDayMs,
        warmupDayTarget: acc.warmupDayTarget,
        status: "idleplay",
        warmupNote: `idle ${s.app}`
      });
    }
  }
  if (patches.length) await api("POST", { accounts: patches });
  const slots = 6;
  const warming = accounts.filter((a) => a.enabled && !a.testOnly && stillWarm(a) && (a.proxy || "").trim());
  for (const acc of warming) ensureDay(acc);
  const want = warming.filter((a) => needHours(a) && !idle.has(a.id) && !liveIds.has(a.id) && !csUntil.has(a.id));
  while (idle.size < slots && want.length) {
    const i = Math.floor(Math.random() * want.length);
    const acc = want.splice(i, 1)[0];
    await startIdle(acc, api);
    await sleepJitter(4000, 12000);
  }
  if (cycleRunning) {
    for (const [id] of [...csUntil.entries()]) {
      csUntil.delete(id);
      const cur = pids.get(id);
      killPid(cur?.steam);
      killPid(cur?.cs);
      pids.delete(id);
      liveIds.delete(id);
    }
    return;
  }
  if ([...csUntil.keys()].length) return;
  const csPool = warming.filter((a) => csDue(a) && !liveIds.has(a.id) && !idle.has(a.id));
  if (!csPool.length) return;
  const acc = csPool[Math.floor(Math.random() * csPool.length)];
  try {
    logOff(acc.id);
    const launched = await launchSteam(acc, liveIds.size);
    const pid = launched && typeof launched === "object" ? launched.pid : launched;
    pids.set(acc.id, { steam: pid, cs: null });
    liveIds.add(acc.id);
    const until = now + jitter(48 * 60000, 72 * 60000);
    csUntil.set(acc.id, until);
    const row = {
      id: acc.id,
      lastCsWarmAt: now,
      status: "cs2",
      pidSteam: pid,
      warmupNote: "cs час"
    };
    if (launched && launched.session && Object.keys(launched.session).length) {
      row.steamSession = launched.session;
      acc.steamSession = launched.session;
    }
    await api("POST", { accounts: [row] });
  } catch (e) {
    await api("POST", { accounts: [{ id: acc.id, status: "error", lastError: String(e.message || e) }] });
  }
}

export function warmupCsCount() {
  return csUntil.size;
}

export function warmupNote() {
  return `прогрев idle ${idle.size} cs ${csUntil.size}`;
}
