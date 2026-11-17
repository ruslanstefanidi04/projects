import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@/shared/lib/ids";
import { getPrisma } from "@/shared/lib/prisma";
import { requireUserId } from "@/shared/lib/session";

const createSchema = z
  .object({
    weekday: z.number().int().min(0).max(6).optional(),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).optional(),
    startMin: z.number().int().min(0).max(24 * 60 - 1),
    endMin: z.number().int().min(1).max(24 * 60),
    title: z.string().min(1).max(120),
    color: z.string().min(4).max(20).optional(),
    icon: z.string().min(1).max(40).optional(),
    note: z.string().max(2000).optional().nullable(),
  })
  .refine((d) => d.weekday != null || (d.weekdays && d.weekdays.length > 0), {
    message: "weekday_required",
  });

export async function GET(req: Request) {
  try {
    const userId = await requireUserId();
    const { searchParams } = new URL(req.url);
    const weekdayRaw = searchParams.get("weekday");
    const weekdaysRaw = searchParams.get("weekdays");
    const prisma = getPrisma();

    let where: { userId: string; weekday?: number | { in: number[] } } = {
      userId,
    };
    if (weekdaysRaw) {
      const list = weekdaysRaw
        .split(",")
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
      if (list.length) where = { userId, weekday: { in: list } };
    } else if (weekdayRaw != null) {
      where = { userId, weekday: Number(weekdayRaw) };
    }

    const blocks = await prisma.scheduleBlock.findMany({
      where,
      orderBy: [{ weekday: "asc" }, { startMin: "asc" }],
    });
    return NextResponse.json({ blocks });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const userId = await requireUserId();
    const prisma = getPrisma();
    const result = await prisma.scheduleBlock.deleteMany({ where: { userId } });
    return NextResponse.json({ ok: true, deleted: result.count });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const data = createSchema.parse(await req.json());
    if (data.endMin <= data.startMin) {
      return NextResponse.json({ error: "range" }, { status: 400 });
    }
    const days = Array.from(
      new Set(
        data.weekdays?.length
          ? data.weekdays
          : data.weekday != null
            ? [data.weekday]
            : [],
      ),
    );
    if (!days.length) {
      return NextResponse.json({ error: "weekday_required" }, { status: 400 });
    }
    const prisma = getPrisma();
    const groupId = createId();
    const created = await prisma.$transaction(
      days.map((weekday) =>
        prisma.scheduleBlock.create({
          data: {
            userId,
            weekday,
            startMin: data.startMin,
            endMin: data.endMin,
            title: data.title,
            color: data.color ?? "#14b8a6",
            icon: data.icon ?? "circle",
            groupId,
            note: data.note ?? null,
          },
        }),
      ),
    );
    return NextResponse.json(
      { blocks: created, block: created[0] },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof Response) return e;
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
