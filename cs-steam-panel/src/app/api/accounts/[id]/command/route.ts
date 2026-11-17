import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { enqueue, listAccounts } from "@/lib/store";
import type { CommandKind } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const acc = (await listAccounts()).find((a) => a.id === id);
  if (!acc) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await req.json()) as { kind?: CommandKind; payload?: string };
  const kind = body.kind;
  if (!kind || !["launch", "stop", "queue", "connect", "refresh", "sendVault", "acceptTrades", "test", "guard"].includes(kind)) {
    return NextResponse.json({ error: "bad kind" }, { status: 400 });
  }
  await enqueue({
    id: randomUUID(),
    accountId: id,
    kind,
    payload: body.payload || "",
    createdAt: Date.now()
  });
  return NextResponse.json({ ok: true });
}
