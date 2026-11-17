import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/shared/lib/prisma";
import { requireUserId } from "@/shared/lib/session";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  note: z.string().max(2000).optional(),
  detail: z.string().max(8000).optional(),
  done: z.boolean().optional(),
  name: z.string().trim().min(1).max(80).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  kind: z.enum(["task", "project"]),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const userId = await requireUserId();
    const data = patchSchema.parse(await req.json());
    const prisma = getPrisma();

    if (data.kind === "project") {
      const existing = await prisma.workProject.findFirst({
        where: { id: params.id, userId },
      });
      if (!existing) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      const project = await prisma.workProject.update({
        where: { id: params.id },
        data: {
          name: data.name,
          color: data.color?.toLowerCase(),
        },
      });
      return NextResponse.json({ project });
    }

    const existing = await prisma.workTask.findFirst({
      where: { id: params.id, userId },
    });
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const task = await prisma.workTask.update({
      where: { id: params.id },
      data: {
        title: data.title,
        note: data.note,
        detail: data.detail,
        done: data.done,
      },
    });
    return NextResponse.json({ task });
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
    const kind = new URL(req.url).searchParams.get("kind");
    const prisma = getPrisma();

    if (kind === "project") {
      const existing = await prisma.workProject.findFirst({
        where: { id: params.id, userId },
      });
      if (!existing) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      await prisma.workProject.delete({ where: { id: params.id } });
      return NextResponse.json({ ok: true });
    }

    const existing = await prisma.workTask.findFirst({
      where: { id: params.id, userId },
    });
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    await prisma.workTask.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
