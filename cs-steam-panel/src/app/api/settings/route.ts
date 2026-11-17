import { NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/store";
import { sleepJitter } from "@/lib/pace";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ settings: await getSettings() });
}

export async function PATCH(req: Request) {
  const body = (await req.json()) as {
    vaultTradeUrl?: string;
    vaultSteamId?: string;
    vaultAccountId?: string;
    botEnabled?: boolean;
    autoMatch?: boolean;
    batchSize?: number;
    passTarget?: number;
    cycleRunning?: boolean;
    proxyPerGroup?: number;
    warmupEnabled?: boolean;
  };
  await sleepJitter(60, 280);
  const settings = await saveSettings({
    vaultTradeUrl: body.vaultTradeUrl !== undefined ? String(body.vaultTradeUrl).trim() : undefined,
    vaultSteamId: body.vaultSteamId !== undefined ? String(body.vaultSteamId).trim() : undefined,
    vaultAccountId: body.vaultAccountId !== undefined ? String(body.vaultAccountId).trim() : undefined,
    botEnabled: body.botEnabled !== undefined ? Boolean(body.botEnabled) : undefined,
    autoMatch: body.autoMatch !== undefined ? Boolean(body.autoMatch) : undefined,
    batchSize: body.batchSize !== undefined ? Number(body.batchSize) : undefined,
    proxyPerGroup: body.proxyPerGroup !== undefined ? Number(body.proxyPerGroup) : undefined,
    passTarget: body.passTarget !== undefined ? Number(body.passTarget) : undefined,
    cycleRunning: body.cycleRunning !== undefined ? Boolean(body.cycleRunning) : undefined,
    warmupEnabled: body.warmupEnabled !== undefined ? Boolean(body.warmupEnabled) : undefined
  });
  return NextResponse.json({ settings });
}
