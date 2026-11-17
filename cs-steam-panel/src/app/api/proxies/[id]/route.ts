import { NextResponse } from "next/server";
import { removeProxy } from "@/lib/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  await removeProxy(id);
  return NextResponse.json({ ok: true });
}
