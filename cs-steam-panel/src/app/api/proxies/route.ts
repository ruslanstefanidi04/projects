import { NextResponse } from "next/server";
import { addProxyLines, listAccounts, listProxies } from "@/lib/store";
import { sleepJitter } from "@/lib/pace";

export const dynamic = "force-dynamic";

function hint(raw: string) {
  const s = raw.trim();
  try {
    if (s.includes("://")) {
      const u = new URL(s);
      return `${u.hostname}${u.port ? ":" + u.port : ""}`;
    }
  } catch {}
  const p = s.split(":");
  return p.length >= 2 ? `${p[0]}:${p[1]}` : s.slice(0, 24);
}

export async function GET() {
  const proxies = await listProxies();
  const accounts = await listAccounts();
  const used = new Map<string, number>();
  for (const a of accounts) {
    if (a.proxyId && !a.testOnly) used.set(a.proxyId, (used.get(a.proxyId) || 0) + 1);
  }
  return NextResponse.json({
    proxies: proxies.map((p) => ({
      ...p,
      hint: hint(p.raw),
      used: used.get(p.id) || 0
    })),
    unbound: accounts.filter((a) => !a.testOnly && !a.proxyId && !a.proxy).length
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as { text?: string };
  await sleepJitter(40, 180);
  const r = await addProxyLines(body.text || "");
  return NextResponse.json(r);
}
