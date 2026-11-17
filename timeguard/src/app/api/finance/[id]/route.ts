import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/shared/lib/prisma";
import { requireUserId } from "@/shared/lib/session";

const patchSchema = z.object({
  kind: z.enum(["income", "expense"]).optional(),
  amount: z.number().positive().max(1_000_000_000).optional(),
  currency: z.string().min(3).max(3).optional(),
  category: z.string().min(1).max(60).optional(),
  title: z.string().max(200).optional(),
  note: z.string().max(2000).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const userId = await requireUserId();
    const data = patchSchema.parse(await req.json());
    const prisma = getPrisma();
    const existing = await prisma.financeTx.findFirst({
      where: { id: params.id, userId },
    });
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const tx = await prisma.financeTx.update({
      where: { id: params.id },
      data,
    });
    return NextResponse.json({ transaction: tx });
  } catch (e) {
    if (e instanceof Response) return e;
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const userId = await requireUserId();
    const prisma = getPrisma();
    const existing = await prisma.financeTx.findFirst({
      where: { id: params.id, userId },
    });
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    await prisma.financeTx.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
