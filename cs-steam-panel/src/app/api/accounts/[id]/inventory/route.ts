import { NextResponse } from "next/server";
import { listAccounts, publicAccount, upsertAccount } from "@/lib/store";
import { fetchInventory } from "@/lib/steam";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const acc = (await listAccounts()).find((a) => a.id === id);
  if (!acc) return NextResponse.json({ error: "not found" }, { status: 404 });
  const inventory = await fetchInventory(acc.steamId);
  const next = await upsertAccount({
    id,
    inventory,
    inventoryAt: Date.now()
  });
  if (!next) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ account: publicAccount(next) });
}
