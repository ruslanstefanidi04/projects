import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/shared/lib/prisma";
import { requireUserId } from "@/shared/lib/session";

const patchSchema = z.object({
  weekday: z.number().int().min(0).max(6).optional(),
  startMin: z.number().int().min(0).max(24 * 60 - 1).optional(),
  endMin: z.number().int().min(1).max(24 * 60).optional(),
  title: z.string().min(1).max(120).optional(),
  color: z.string().min(4).max(20).optional(),
  icon: z.string().min(1).max(40).optional(),
  note: z.string().max(2000).optional().nullable(),
  /** Update all blocks in the same series */
  scope: z.enum(["one", "group"]).optional(),
});

function seriesWhere(
  userId: string,
  existing: {
    id: string;
    groupId: string | null;
    title: string;
    startMin: number;
    endMin: number;
    color: string;
    icon: string;
  },
) {
  if (existing.groupId) {
    return { userId, groupId: existing.groupId };
  }
  return {
    userId,
    title: existing.title,
    startMin: existing.startMin,
    endMin: existing.endMin,
    color: existing.color,
    icon: existing.icon,
  };
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const userId = await requireUserId();
    const data = patchSchema.parse(await req.json());
    const prisma = getPrisma();
    const existing = await prisma.scheduleBlock.findFirst({
      where: { id: params.id, userId },
    });
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const startMin = data.startMin ?? existing.startMin;
    const endMin = data.endMin ?? existing.endMin;
    if (endMin <= startMin) {
      return NextResponse.json({ error: "range" }, { status: 400 });
    }

    const patch = {
      title: data.title,
      color: data.color,
      icon: data.icon,
      note: data.note,
      startMin,
      endMin,
      weekday: data.weekday,
    };

    if (data.scope === "group") {
      const result = await prisma.scheduleBlock.updateMany({
        where: seriesWhere(userId, existing),
        data: {
          title: data.title ?? existing.title,
          color: data.color ?? existing.color,
          icon: data.icon ?? existing.icon,
          note: data.note === undefined ? undefined : data.note,
          startMin,
          endMin,
        },
      });
      const block = await prisma.scheduleBlock.findFirst({
        where: { id: params.id, userId },
      });
      return NextResponse.json({ block, updated: result.count });
    }

    const block = await prisma.scheduleBlock.update({
      where: { id: params.id },
      data: patch,
    });
    return NextResponse.json({ block });
  } catch (e) {
    if (e instanceof Response) return e;
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const userId = await requireUserId();
    const scope =
      new URL(req.url).searchParams.get("scope") === "one" ? "one" : "group";
    const prisma = getPrisma();
    const existing = await prisma.scheduleBlock.findFirst({
      where: { id: params.id, userId },
    });
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    if (scope === "one") {
      await prisma.scheduleBlock.delete({ where: { id: params.id } });
      return NextResponse.json({ ok: true, deleted: 1 });
    }

    const result = await prisma.scheduleBlock.deleteMany({
      where: seriesWhere(userId, existing),
    });
    return NextResponse.json({ ok: true, deleted: result.count });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
