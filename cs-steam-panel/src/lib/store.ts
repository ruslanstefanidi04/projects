import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import type { Account, Command, ProxyEntry, Settings, StoreShape } from "./types";

function keyBuf() {
  return scryptSync(process.env.SESSION_SECRET || "cs-farm", "cs-farm-store", 32);
}

function encryptAny(data: unknown) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyBuf(), iv);
  const out = Buffer.concat([c.update(JSON.stringify(data), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), out]).toString("base64");
}

function decryptAny(raw: string): unknown {
  const buf = Buffer.from(raw, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const d = createDecipheriv("aes-256-gcm", keyBuf(), iv);
  d.setAuthTag(tag);
  const text = Buffer.concat([d.update(enc), d.final()]).toString("utf8");
  return JSON.parse(text);
}

function encryptJson(data: StoreShape) {
  return encryptAny(data);
}

function decryptJson(raw: string): StoreShape {
  return decryptAny(raw) as StoreShape;
}

const g = globalThis as unknown as {
  __csStore?: StoreShape;
  __csLastGood?: StoreShape;
  __csBlobUrls?: Record<string, string>;
};

export function emptySettings(): Settings {
  return {
    vaultTradeUrl: "",
    vaultSteamId: "",
    vaultAccountId: "",
    botEnabled: true,
    botNote: "",
    autoMatch: true,
    batchSize: 5,
    passTarget: 14,
    cycleRunning: false,
    proxyPerGroup: 5,
    warmupEnabled: true
  };
}

type SaveOpts = { dropCommands?: boolean; removedIds?: string[] };

function empty(): StoreShape {
  return { accounts: [], commands: [], settings: emptySettings(), proxies: [], steamMetaAt: 0, gone: [] };
}

function normalize(data: StoreShape): StoreShape {
  return {
    accounts: (data.accounts || []).map((a) => ({
      ...a,
      identitySecret: a.identitySecret || "",
      ipcName: a.ipcName || "",
      proxy: a.proxy || "",
      lastTradeAt: a.lastTradeAt || 0,
      tradeNote: a.tradeNote || "",
      passMatches: a.passMatches || 0,
      rewardsClaimed: Boolean(a.rewardsClaimed),
      passDone: Boolean(a.passDone),
      proxyId: a.proxyId || "",
      warmupUntil: a.warmupUntil || 0,
      warmupDone: Boolean(a.warmupDone),
      warmupDay: a.warmupDay || "",
      warmupDayMs: a.warmupDayMs || 0,
      warmupDayTarget: a.warmupDayTarget || 0,
      lastCsWarmAt: a.lastCsWarmAt || 0,
      warmupLicensed: Boolean(a.warmupLicensed),
      warmupNote: a.warmupNote || "",
      testOnly: Boolean(a.testOnly),
      email: a.email || "",
      steamSession: a.steamSession && typeof a.steamSession === "object" ? a.steamSession : {},
      vmSlot: a.vmSlot || ""
    })).filter((a) => String(a.login || "").trim()),
    commands: data.commands || [],
    settings: { ...emptySettings(), ...(data.settings || {}) },
    proxies: data.proxies || [],
    steamMetaAt: data.steamMetaAt || 0,
    gone: data.gone || []
  };
}

function filePath() {
  return path.join(process.cwd(), "data", "store.json");
}

type AccIndexRow = { id: string; login: string; testOnly: boolean; email: string };

async function readEncrypted(name: string): Promise<unknown | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  const urls: string[] = [];
  const cached = g.__csBlobUrls?.[name];
  if (cached) urls.push(cached);
  try {
    const { list } = await import("@vercel/blob");
    const res = await list({ prefix: name, limit: 30, token });
    const blobs = [...(res.blobs || [])].sort(
      (a, b) => +new Date(String(b.uploadedAt || 0)) - +new Date(String(a.uploadedAt || 0))
    );
    const exact = blobs.filter((b) => b.pathname === name || String(b.pathname || "").endsWith("/" + name));
    for (const b of exact.length ? exact : blobs) {
      if (b.url && !urls.includes(b.url)) urls.push(b.url);
    }
  } catch {}
  for (const url of urls) {
    try {
      const clean = url.split("?")[0];
      const r = await fetch(clean + "?t=" + Date.now(), {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!r.ok) continue;
      const data = decryptAny(await r.text());
      g.__csBlobUrls = { ...(g.__csBlobUrls || {}), [name]: clean };
      return data;
    } catch {}
  }
  return null;
}

async function readNamedBlob(name: string): Promise<StoreShape | null> {
  const data = await readEncrypted(name);
  if (!data || typeof data !== "object") return null;
  return normalize(data as StoreShape);
}

async function readIndex(): Promise<AccIndexRow[]> {
  const data = await readEncrypted("cs-index.json");
  if (!Array.isArray(data)) return [];
  return data.filter((x): x is AccIndexRow => Boolean(x && typeof x === "object" && x.id && x.login));
}

function slimAcc(a: Account): Account {
  return { ...a, steamSession: {} };
}

function stubAccount(row: AccIndexRow): Account {
  const a = buildAccount({ id: row.id, login: row.login, testOnly: row.testOnly, email: row.email || "" }, 1);
  a.updatedAt = 0;
  a.createdAt = 1;
  return a;
}

async function mergeIndex(accounts: Account[], removedIds: string[]): Promise<AccIndexRow[]> {
  const prev = await readIndex();
  const map = new Map<string, AccIndexRow>();
  for (const row of prev) {
    if (removedIds.includes(row.id)) continue;
    map.set(row.id, row);
  }
  for (const a of accounts) {
    if (removedIds.includes(a.id)) continue;
    const old = map.get(a.id);
    map.set(a.id, {
      id: a.id,
      login: a.login || old?.login || "",
      testOnly: Boolean(a.testOnly || old?.testOnly),
      email: a.email || old?.email || ""
    });
  }
  return [...map.values()].filter((r) => r.login);
}

function mergeBlobParts(store: StoreShape | null, accs: StoreShape | null): StoreShape | null {
  if (!store && !accs) return null;
  const base = store || empty();
  const gone = [...new Set([...(base.gone || []), ...(accs?.gone || [])])];
  const accounts = unionAccounts([base.accounts || [], accs?.accounts || []]).filter((a) => !gone.includes(a.id));
  return normalize({ ...base, accounts, gone });
}

async function loadAccBlobs(): Promise<{ accounts: Account[]; deletedIds: string[] }> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return { accounts: [], deletedIds: [] };
  try {
    const { list } = await import("@vercel/blob");
    const res = await list({ prefix: "acc/", limit: 1000, token });
    const accounts: Account[] = [];
    const deletedIds: string[] = [];
    for (const b of res.blobs || []) {
      const pathn = String(b.pathname || "");
      if (!b.url || !pathn.includes("acc/")) continue;
      try {
        const r = await fetch(String(b.url).split("?")[0] + "?t=" + Date.now(), {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!r.ok) continue;
        const raw = decryptAny(await r.text()) as Account & { deleted?: boolean };
        if (!raw || !raw.id) continue;
        if (raw.deleted) {
          deletedIds.push(raw.id);
          continue;
        }
        if (!String(raw.login || "").trim()) continue;
        accounts.push(raw);
      } catch {}
    }
    return { accounts, deletedIds };
  } catch {
    return { accounts: [], deletedIds: [] };
  }
}

async function saveAccBlobs(accounts: Account[], removedIds: string[] = []) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return;
  const { put } = await import("@vercel/blob");
  const putOpts = {
    access: "public" as const,
    token,
    addRandomSuffix: false,
    contentType: "text/plain"
  };
  for (const id of removedIds) {
    await put(`acc/${id}.json`, encryptAny({ id, deleted: true }), putOpts);
  }
  for (const a of accounts) {
    if (removedIds.includes(a.id)) continue;
    await put(`acc/${a.id}.json`, encryptAny(a), putOpts);
  }
}

async function fromBlob(): Promise<StoreShape | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  try {
    const store = await readNamedBlob("cs-store.json");
    const accs = await readNamedBlob("cs-accounts.json");
    const index = await readIndex();
    const { accounts: files, deletedIds } = await loadAccBlobs();
    const stubs = index.filter((row) => !deletedIds.includes(row.id)).map(stubAccount);
    const accounts = unionAccounts([store?.accounts || [], accs?.accounts || [], files, stubs]).filter(
      (a) => !deletedIds.includes(a.id)
    );
    const base = store || accs || (accounts.length ? empty() : null);
    if (!base && !accounts.length) return null;
    return normalize({
      ...(base || empty()),
      accounts,
      gone: deletedIds
    });
  } catch {
    return null;
  }
}

async function toBlob(data: StoreShape, opts: SaveOpts = {}) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return false;
  try {
    const { put } = await import("@vercel/blob");
    const putOpts = {
      access: "public" as const,
      token,
      addRandomSuffix: false,
      contentType: "text/plain"
    };
    const slim: StoreShape = { ...data, accounts: data.accounts.map(slimAcc) };
    const storePut = await put("cs-store.json", encryptJson(slim), putOpts);
    g.__csBlobUrls = { ...(g.__csBlobUrls || {}), "cs-store.json": storePut.url };
    if (data.accounts.length || (opts.removedIds || []).length) {
      const accPut = await put(
        "cs-accounts.json",
        encryptJson({ ...empty(), accounts: slim.accounts, gone: data.gone || [] }),
        putOpts
      );
      g.__csBlobUrls["cs-accounts.json"] = accPut.url;
      const idxPut = await put("cs-index.json", encryptAny(await mergeIndex(data.accounts, opts.removedIds || [])), putOpts);
      g.__csBlobUrls["cs-index.json"] = idxPut.url;
      await saveAccBlobs(data.accounts, opts.removedIds || []);
    }
    return true;
  } catch {
    return false;
  }
}

async function fromFs(): Promise<StoreShape | null> {
  try {
    const raw = await readFile(filePath(), "utf8");
    return normalize(JSON.parse(raw) as StoreShape);
  } catch {
    return null;
  }
}

async function toFs(data: StoreShape) {
  try {
    await mkdir(path.dirname(filePath()), { recursive: true });
    await writeFile(filePath(), JSON.stringify(data), "utf8");
    return true;
  } catch {
    return false;
  }
}

function pickAcc(a: Account, b: Account): Account {
  const bNewer = (b.updatedAt || 0) >= (a.updatedAt || 0);
  const newer = bNewer ? b : a;
  const older = bNewer ? a : b;
  return {
    ...older,
    ...newer,
    login: newer.login || older.login,
    password: newer.password || older.password,
    sharedSecret: newer.sharedSecret || older.sharedSecret,
    identitySecret: newer.identitySecret || older.identitySecret,
    steamId: newer.steamId || older.steamId,
    steamPath: newer.steamPath || older.steamPath,
    email: newer.email || older.email,
    steamSession:
      Object.keys(newer.steamSession || {}).length >= Object.keys(older.steamSession || {}).length
        ? newer.steamSession || {}
        : older.steamSession || {},
    testOnly: Boolean(older.testOnly || newer.testOnly),
    warmupUntil: (newer.login ? newer.testOnly : older.testOnly) ? 0 : newer.warmupUntil || older.warmupUntil,
    warmupDone: (newer.login ? newer.testOnly : older.testOnly) ? true : Boolean(newer.warmupDone)
  };
}

function unionAccounts(chunks: Account[][]): Account[] {
  const map = new Map<string, Account>();
  for (const list of chunks) {
    for (const a of list || []) {
      if (!a?.id) continue;
      const prev = map.get(a.id);
      map.set(a.id, prev ? pickAcc(prev, a) : a);
    }
  }
  return [...map.values()].filter((a) => String(a.login || "").trim());
}

function unionProxies(chunks: ProxyEntry[][]): ProxyEntry[] {
  const map = new Map<string, ProxyEntry>();
  for (const list of chunks) {
    for (const p of list || []) {
      if (p?.id) map.set(p.id, p);
    }
  }
  return [...map.values()];
}

function remember(data: StoreShape, force = false) {
  if (!data.accounts.length && !force) {
    if (!g.__csStore) g.__csStore = data;
    return;
  }
  g.__csStore = data;
  g.__csLastGood = data;
}

export async function loadStore(): Promise<StoreShape> {
  const blob = await fromBlob();
  const fs = blob ? null : await fromFs();
  const hit = blob || fs || g.__csStore || empty();
  const gone = [...new Set([...(hit.gone || [])])];
  const merged = normalize({
    ...hit,
    gone,
    accounts: unionAccounts([hit.accounts, g.__csStore?.accounts || [], g.__csLastGood?.accounts || []]).filter(
      (a) => !gone.includes(a.id)
    ),
    proxies: unionProxies([hit.proxies || [], g.__csStore?.proxies || [], g.__csLastGood?.proxies || []])
  });
  remember(merged);
  return merged;
}

export async function saveStore(data: StoreShape, opts: SaveOpts = {}) {
  const latest = await fromBlob();
  const gone = [...new Set([...(opts.removedIds || []), ...((opts.removedIds || []).length ? data.gone || [] : latest?.gone || [])])];
  const accounts = unionAccounts([
    latest?.accounts || [],
    g.__csLastGood?.accounts || [],
    g.__csStore?.accounts || [],
    data.accounts || []
  ]).filter((a) => !gone.includes(a.id));
  const proxies = unionProxies([latest?.proxies || [], g.__csLastGood?.proxies || [], data.proxies || []]);
  const next: StoreShape = {
    accounts,
    proxies,
    gone: gone.filter((id) => !accounts.some((a) => a.id === id)),
    commands: opts.dropCommands
      ? []
      : [...(latest?.commands || []), ...(data.commands || [])]
          .filter((c, i, all) => all.findIndex((x) => x.id === c.id) === i)
          .filter((c) => !gone.includes(c.accountId)),
    settings: { ...emptySettings(), ...(latest?.settings || {}), ...(data.settings || {}) },
    steamMetaAt: Math.max(Number(latest?.steamMetaAt) || 0, Number(data.steamMetaAt) || 0)
  };
  remember(next, Boolean(opts.removedIds) && !next.accounts.length);
  if (!next.accounts.length && !(opts.removedIds || []).length) return;
  if (await toBlob(next, opts)) return;
  await toFs(next);
}

export async function listAccounts() {
  return (await loadStore()).accounts;
}

export async function listProxies() {
  return (await loadStore()).proxies;
}

export async function addProxyLines(text: string) {
  const store = await loadStore();
  const per = Math.max(1, store.settings.proxyPerGroup || 5);
  const have = new Set(store.proxies.map((p) => p.raw.trim()));
  let added = 0;
  for (const line of text.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw || raw.startsWith("#") || have.has(raw)) continue;
    store.proxies.push({ id: randomUUID(), raw, maxSlots: per });
    have.add(raw);
    added += 1;
  }
  await saveStore(store);
  return { added, total: store.proxies.length };
}

export async function removeProxy(id: string) {
  const store = await loadStore();
  store.proxies = store.proxies.filter((p) => p.id !== id);
  await saveStore(store);
}

export async function assignSticky() {
  const store = await loadStore();
  const per = Math.max(1, store.settings.proxyPerGroup || 5);
  for (const a of store.accounts) {
    if (a.testOnly) continue;
    if (a.proxyId) continue;
    if (!a.proxy) continue;
    const hit = store.proxies.find((p) => p.raw.trim() === a.proxy.trim());
    if (hit) a.proxyId = hit.id;
  }
  const used = new Map<string, number>();
  for (const a of store.accounts) {
    if (!a.proxyId) continue;
    used.set(a.proxyId, (used.get(a.proxyId) || 0) + 1);
  }
  const free = store.accounts.filter((a) => !a.testOnly && !a.proxyId && !a.proxy);
  let assigned = 0;
  for (const p of store.proxies) {
    const cap = p.maxSlots || per;
    let n = used.get(p.id) || 0;
    while (n < cap && free.length) {
      const acc = free.shift()!;
      acc.proxyId = p.id;
      acc.proxy = p.raw;
      acc.updatedAt = Date.now();
      n += 1;
      assigned += 1;
    }
    used.set(p.id, n);
  }
  await saveStore(store);
  return { assigned, leftover: free.length, per };
}

const WORKER_KEYS = new Set([
  "workerAt",
  "status",
  "lastError",
  "pidSteam",
  "pidCs",
  "fpsCap",
  "network",
  "tradeNote",
  "passMatches",
  "passDone",
  "warmupDay",
  "warmupDayMs",
  "warmupDayTarget",
  "lastCsWarmAt",
  "warmupLicensed",
  "warmupNote",
  "warmupDone",
  "steamSession"
]);

type UpsertOpts = { create?: boolean; fromWorker?: boolean };

function mergeAccount(cur: Account, partial: Partial<Account>, fromWorker: boolean): Account {
  const next: Account = { ...cur };
  for (const [k, v] of Object.entries(partial)) {
    if (k === "id" || v === undefined) continue;
    if (fromWorker && !WORKER_KEYS.has(k)) continue;
    if (fromWorker && (k === "login" || k === "email" || k === "testOnly" || k === "password" || k === "sharedSecret" || k === "identitySecret")) continue;
    if (
      k === "steamSession" &&
      (!v || typeof v !== "object" || !Object.keys(v as object).length) &&
      cur.steamSession &&
      Object.keys(cur.steamSession).length
    ) {
      continue;
    }
    if (
      (k === "login" || k === "email" || k === "password" || k === "sharedSecret" || k === "identitySecret" || k === "steamId") &&
      v === "" &&
      (cur as unknown as Record<string, unknown>)[k]
    ) {
      continue;
    }
    (next as unknown as Record<string, unknown>)[k] = v;
  }
  next.updatedAt = Date.now();
  return next;
}

function buildAccount(partial: Partial<Account> & { id: string }, now: number): Account {
  return {
    id: partial.id,
    login: partial.login || "",
    email: partial.email || "",
    password: partial.password || "",
    steamId: partial.steamId || "",
    sharedSecret: partial.sharedSecret || "",
    identitySecret: partial.identitySecret || "",
    steamPath: partial.steamPath || "",
    ipcName: partial.ipcName || partial.login || partial.id,
    proxy: partial.proxy || "",
    enabled: partial.enabled ?? true,
    matchKind: partial.matchKind || "competitive",
    connectHost: partial.connectHost || "",
    persona: partial.persona || "",
    avatar: partial.avatar || "",
    status: partial.status || "idle",
    lastError: partial.lastError || "",
    network: partial.network || {
      steamOk: false,
      pingMs: null,
      inGame: false,
      ipc: null
    },
    inventory: partial.inventory || [],
    inventoryAt: partial.inventoryAt || 0,
    workerAt: partial.workerAt || 0,
    pidSteam: partial.pidSteam ?? null,
    pidCs: partial.pidCs ?? null,
    fpsCap: partial.fpsCap || 20,
    lastTradeAt: partial.lastTradeAt || 0,
    tradeNote: partial.tradeNote || "",
    passMatches: partial.passMatches || 0,
    rewardsClaimed: partial.rewardsClaimed || false,
    passDone: partial.passDone || false,
    proxyId: partial.proxyId || "",
    warmupUntil: partial.testOnly ? 0 : now + 14 * 86400000,
    warmupDone: Boolean(partial.testOnly),
    warmupDay: "",
    warmupDayMs: 0,
    warmupDayTarget: 0,
    lastCsWarmAt: 0,
    warmupLicensed: false,
    warmupNote: "",
    testOnly: Boolean(partial.testOnly),
    steamSession: partial.steamSession || {},
    vmSlot: partial.vmSlot || "",
    createdAt: now,
    updatedAt: now
  };
}

export async function patchAccounts(partials: Array<Partial<Account> & { id: string }>, opts: UpsertOpts = {}) {
  const store = await loadStore();
  const fromWorker = Boolean(opts.fromWorker);
  const allowCreate = opts.create !== false && !fromWorker;
  const out: Account[] = [];
  for (const partial of partials) {
    if (!partial.id) continue;
    const i = store.accounts.findIndex((a) => a.id === partial.id);
    if (i === -1) {
      if (!allowCreate || !String(partial.login || "").trim()) continue;
      const acc = buildAccount(partial, Date.now());
      store.accounts.push(acc);
      out.push(acc);
      continue;
    }
    store.accounts[i] = mergeAccount(store.accounts[i], partial, fromWorker);
    out.push(store.accounts[i]);
  }
  if (fromWorker && !out.length) return out;
  await saveStore(store);
  return out;
}

export async function applyWorkerSync(settings: Partial<Settings> | undefined, partials: Array<Partial<Account> & { id: string }>) {
  const store = await loadStore();
  if (!store.accounts.length) {
    const born = partials.filter((p) => p.id && String(p.login || "").trim());
    if (!born.length) return;
    console.log("restore accounts from worker", born.length);
    for (const p of born) store.accounts.push(buildAccount(p, Date.now()));
    if (settings) store.settings = { ...store.settings, ...settings };
    await saveStore(store);
    return;
  }
  if (settings) store.settings = { ...store.settings, ...settings };
  for (const partial of partials) {
    const i = store.accounts.findIndex((a) => a.id === partial.id);
    if (i === -1) continue;
    store.accounts[i] = mergeAccount(store.accounts[i], partial, true);
  }
  await saveStore(store);
}

export async function upsertAccount(partial: Partial<Account> & { id: string }, opts: UpsertOpts = {}) {
  const [acc] = await patchAccounts([partial], opts);
  return acc;
}

export async function removeAccount(id: string) {
  const store = await loadStore();
  store.accounts = store.accounts.filter((a) => a.id !== id);
  store.commands = store.commands.filter((c) => c.accountId !== id);
  await saveStore(store, { removedIds: [id] });
}

export async function enqueue(cmd: Command) {
  const store = await loadStore();
  store.commands.push(cmd);
  await saveStore(store);
}

export async function takeCommands() {
  const store = await loadStore();
  const cmds = store.commands;
  if (!cmds.length) return [];
  store.commands = [];
  await saveStore(store, { dropCommands: true });
  return cmds;
}

export async function workerPoll() {
  const store = await loadStore();
  const cmds = store.commands;
  if (cmds.length) {
    store.commands = [];
    await saveStore(store, { dropCommands: true });
  }
  return { accounts: store.accounts, commands: cmds, settings: store.settings };
}

export async function getSettings() {
  return (await loadStore()).settings;
}

export async function saveSettings(patch: Partial<Settings>) {
  const store = await loadStore();
  store.settings = { ...store.settings, ...patch };
  await saveStore(store);
  return store.settings;
}

export async function touchSteamMeta() {
  const store = await loadStore();
  if (!store.accounts.length) return;
  store.steamMetaAt = Date.now();
  await saveStore(store);
}

export async function steamMetaAt() {
  return (await loadStore()).steamMetaAt;
}

export function publicAccount(a: Account) {
  const { password, sharedSecret, identitySecret, proxy, steamSession, ...rest } = a;
  let proxyHint = "";
  if (proxy) {
    try {
      if (proxy.includes("://")) {
        const u = new URL(proxy);
        proxyHint = `${u.hostname}${u.port ? ":" + u.port : ""}`;
      } else {
        const p = proxy.split(":");
        proxyHint = p.length >= 2 ? `${p[0]}:${p[1]}` : "on";
      }
    } catch {
      proxyHint = "on";
    }
  }
  return {
    ...rest,
    hasPassword: Boolean(password),
    hasGuard: Boolean(sharedSecret),
    hasIdentity: Boolean(identitySecret),
    hasProxy: Boolean(proxy || a.proxyId),
    hasSession: Boolean(steamSession && Object.keys(steamSession).length),
    proxyHint
  };
}
