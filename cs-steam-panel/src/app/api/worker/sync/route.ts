import { NextResponse } from "next/server";
import { checkWorker } from "@/lib/session";
import { applyWorkerSync, workerPoll } from "@/lib/store";
import type { Account, Settings } from "@/lib/types";
import { gates } from "@/lib/pace";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!checkWorker(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { accounts, commands, settings } = await workerPoll();
  return NextResponse.json({ accounts, commands, settings });
}

export async function POST(req: Request) {
  if (!checkWorker(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await gates.workerWrite.take();
  const body = (await req.json()) as { accounts?: Partial<Account>[]; settings?: Partial<Settings> };
  const list = (body.accounts || []).filter((a): a is Partial<Account> & { id: string } => Boolean(a.id));
  await applyWorkerSync(body.settings, list);
  return NextResponse.json({ ok: true });
}
