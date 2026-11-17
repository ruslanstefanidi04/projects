import { NextResponse } from "next/server";
import { assignSticky } from "@/lib/store";
import { sleepJitter } from "@/lib/pace";

export const dynamic = "force-dynamic";

export async function POST() {
  await sleepJitter(40, 200);
  const r = await assignSticky();
  return NextResponse.json(r);
}
