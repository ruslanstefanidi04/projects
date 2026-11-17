const COOKIE = "cs_panel_session";

function secret() {
  const s = process.env.SESSION_SECRET || "";
  if (!s) throw new Error("SESSION_SECRET missing");
  return s;
}

function bytes(s: string) {
  return new TextEncoder().encode(s);
}

function b64url(buf: ArrayBuffer | Uint8Array) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64url(s: string) {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

function safeEq(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a[i] ^ b[i];
  return x === 0;
}

async function hmac(data: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    bytes(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", key, bytes(data));
}

export async function signSession(user: string, exp: number) {
  const payload = `${user}.${exp}`;
  const sig = b64url(await hmac(payload));
  return `${payload}.${sig}`;
}

export async function readSession(token: string | undefined) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [user, expRaw, sig] = parts;
  const exp = Number(expRaw);
  if (!user || !Number.isFinite(exp) || exp < Date.now()) return null;
  const expected = new Uint8Array(await hmac(`${user}.${exp}`));
  let got: Uint8Array;
  try {
    got = fromB64url(sig);
  } catch {
    return null;
  }
  if (!safeEq(got, expected)) return null;
  if (user !== (process.env.PANEL_USER || "")) return null;
  return { user };
}

export function sessionCookie(token: string, maxAge: number) {
  const secure = process.env.VERCEL || process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function cookieName() {
  return COOKIE;
}

export function checkPassword(user: string, pass: string) {
  const u = process.env.PANEL_USER || "";
  const p = process.env.PANEL_PASSWORD || "";
  if (!u || !p) return false;
  return safeEq(bytes(user), bytes(u)) && safeEq(bytes(pass), bytes(p));
}

export function checkWorker(authHeader: string | null) {
  const token = process.env.WORKER_TOKEN || "";
  if (!token || !authHeader) return false;
  const got = authHeader.replace(/^Bearer\s+/i, "");
  return safeEq(bytes(got), bytes(token));
}
