import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/shared/lib/prisma";
import { requireUserId } from "@/shared/lib/session";

const createSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().min(1).max(200),
});

export async function GET(req: Request) {
  try {
    const userId = await requireUserId();
    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const date = searchParams.get("date");
    const prisma = getPrisma();

    const where =
      date != null
        ? { userId, date }
        : from && to
          ? { userId, date: { gte: from, lte: to } }
          : { userId };

    const reminders = await prisma.reminder.findMany({
      where,
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    });
    return NextResponse.json({ reminders });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const data = createSchema.parse(await req.json());
    const prisma = getPrisma();
    const reminder = await prisma.reminder.create({
      data: {
        userId,
        date: data.date,
        title: data.title.trim(),
      },
    });
    return NextResponse.json({ reminder }, { status: 201 });
  } catch (e) {
    if (e instanceof Response) return e;
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
