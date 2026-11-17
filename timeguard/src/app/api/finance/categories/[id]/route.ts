import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/shared/lib/prisma";
import { requireUserId } from "@/shared/lib/session";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  emoji: z.string().trim().min(1).max(8).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  kind: z.enum(["expense", "income", "both"]).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const userId = await requireUserId();
    const data = patchSchema.parse(await req.json());
    const prisma = getPrisma();
    const existing = await prisma.financeCategory.findFirst({
      where: { id: params.id, userId },
    });
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const category = await prisma.financeCategory.update({
      where: { id: params.id },
      data: {
        name: data.name,
        emoji: data.emoji,
        color: data.color?.toLowerCase(),
        kind: data.kind,
        builtin:
          data.name && data.name !== existing.name ? false : existing.builtin,
      },
    });
    return NextResponse.json({ category });
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
    const existing = await prisma.financeCategory.findFirst({
      where: { id: params.id, userId },
    });
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    await prisma.financeCategory.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
