import { NextResponse } from "next/server";
import { saveSettings } from "@/lib/store";
import { sleepJitter } from "@/lib/pace";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json()) as { running?: boolean };
  await sleepJitter(40, 200);
  const settings = await saveSettings({ cycleRunning: Boolean(body.running) });
  return NextResponse.json({ settings });
}
