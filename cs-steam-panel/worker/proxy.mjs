export function parseProxy(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  try {
    if (/^https?:\/\//i.test(s) || /^socks5h?:\/\//i.test(s)) {
      const u = new URL(s);
      return {
        kind: u.protocol.replace(":", "").toLowerCase().startsWith("socks") ? "socks" : "http",
        host: u.hostname,
        port: Number(u.port) || (u.protocol.startsWith("socks") ? 1080 : 8080),
        user: decodeURIComponent(u.username || ""),
        pass: decodeURIComponent(u.password || ""),
        url: s
      };
    }
  } catch {}
  const p = s.split(":");
  if (p.length >= 2 && p[0] && p[1]) {
    const host = p[0];
    const port = Number(p[1]);
    if (!Number.isFinite(port)) return null;
    return {
      kind: "socks",
      host,
      port,
      user: p[2] || "",
      pass: p.slice(3).join(":") || "",
      url: p[2]
        ? `socks5://${encodeURIComponent(p[2])}:${encodeURIComponent(p.slice(3).join(":") || "")}@${host}:${port}`
        : `socks5://${host}:${port}`
    };
  }
  return null;
}

export function proxyHint(raw) {
  const p = parseProxy(raw);
  if (!p) return "";
  return `${p.kind} ${p.host}:${p.port}`;
}

export function steamUserProxy(raw) {
  const p = parseProxy(raw);
  if (!p) return {};
  if (p.kind === "socks") return { socksProxy: p.url };
  return { httpProxy: p.url };
}

export function spawnEnv(raw) {
  const p = parseProxy(raw);
  const env = { ...process.env };
  if (!p) return env;
  env.ALL_PROXY = p.url;
  env.HTTPS_PROXY = p.url;
  env.HTTP_PROXY = p.url;
  return env;
}

export function shellLayout(seed, index) {
  let h = 2166136261;
  const s = String(seed || "") + ":" + String(index || 0);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  const n = h >>> 0;
  const cols = 4;
  const w = 480 + (n % 5) * 32;
  const ht = 360 + ((n >> 3) % 4) * 24;
  const x = (index % cols) * 210 + (n % 37);
  const y = Math.floor(index / cols) * 160 + ((n >> 8) % 29);
  const fps = 18 + (n % 5);
  return { w, h: ht, x, y, fps };
}
