import { NextResponse } from "next/server";
import { listAccounts, publicAccount, removeAccount, upsertAccount } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const acc = (await listAccounts()).find((a) => a.id === id);
  if (!acc) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ account: publicAccount(acc) });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const acc = (await listAccounts()).find((a) => a.id === id);
  if (!acc) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await req.json()) as Record<string, unknown>;
  const patch: Record<string, unknown> = { id };
  for (const k of [
    "login",
    "password",
    "steamId",
    "sharedSecret",
    "steamPath",
    "ipcName",
    "enabled",
    "matchKind",
    "connectHost",
    "fpsCap",
    "identitySecret",
    "rewardsClaimed",
    "passDone",
    "passMatches",
    "proxy",
    "warmupDone",
    "warmupUntil",
    "warmupNote",
    "testOnly",
    "email"
  ]) {
    if (k in body) patch[k] = body[k];
  }
  if (typeof patch.password === "string" && patch.password === "") delete patch.password;
  if (typeof patch.sharedSecret === "string" && patch.sharedSecret === "") delete patch.sharedSecret;
  if (typeof patch.identitySecret === "string" && patch.identitySecret === "") delete patch.identitySecret;
  const next = await upsertAccount(patch as { id: string });
  if (!next) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ account: publicAccount(next) });
}

export async function DELETE(_: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  await removeAccount(id);
  return NextResponse.json({ ok: true });
}
