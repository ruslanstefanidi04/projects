import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSettings, listAccounts, listProxies, publicAccount, upsertAccount } from "@/lib/store";
import { sleepJitter } from "@/lib/pace";

export const dynamic = "force-dynamic";

export async function GET() {
  const accounts = await listAccounts();
  const settings = await getSettings();
  const proxies = await listProxies();
  return NextResponse.json({
    accounts: accounts.map(publicAccount),
    steamPing: accounts[0]?.network.pingMs ?? null,
    settings,
    proxies: proxies.map((p) => ({ id: p.id, maxSlots: p.maxSlots })),
    unbound: accounts.filter((a) => !a.testOnly && !a.proxyId && !a.proxy).length
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    login?: string;
    password?: string;
    steamId?: string;
    sharedSecret?: string;
    identitySecret?: string;
    steamPath?: string;
    ipcName?: string;
    matchKind?: "competitive" | "premier" | "wingman" | "deathmatch" | "casual";
    connectHost?: string;
    fpsCap?: number;
    proxy?: string;
    testOnly?: boolean;
    email?: string;
  };
  const login = (body.login || "").trim();
  if (!login) return NextResponse.json({ error: "login required" }, { status: 400 });
  await sleepJitter(80, 400);
  const have = (await listAccounts()).find((a) => a.login.toLowerCase() === login.toLowerCase());
  const acc = await upsertAccount({
    id: have?.id || randomUUID(),
    login,
    password: body.password || "",
    steamId: (body.steamId || "").trim() || have?.steamId,
    sharedSecret: (body.sharedSecret || "").trim(),
    identitySecret: (body.identitySecret || "").trim(),
    steamPath: (body.steamPath || "").trim(),
    ipcName: (body.ipcName || login).trim(),
    matchKind: body.matchKind || have?.matchKind || "competitive",
    connectHost: (body.connectHost || "").trim(),
    fpsCap: body.fpsCap || 20,
    proxy: (body.proxy || "").trim(),
    testOnly: body.testOnly ?? have?.testOnly ?? false,
    email: (body.email || "").trim()
  });
  if (!acc) return NextResponse.json({ error: "save failed" }, { status: 500 });
  return NextResponse.json({ account: publicAccount(acc) });
}
