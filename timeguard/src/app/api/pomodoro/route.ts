import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/shared/lib/prisma";
import { requireUserId } from "@/shared/lib/session";

const createSchema = z.object({
  kind: z.enum(["focus", "break", "long"]),
  durationSec: z.number().int().min(1).max(3 * 60 * 60),
  completed: z.boolean().optional(),
});

export async function GET() {
  try {
    const userId = await requireUserId();
    const prisma = getPrisma();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const sessions = await prisma.pomodoroSession.findMany({
      where: { userId, startedAt: { gte: start } },
      orderBy: { startedAt: "desc" },
    });
    return NextResponse.json({ sessions });
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
    const session = await prisma.pomodoroSession.create({
      data: {
        userId,
        kind: data.kind,
        durationSec: data.durationSec,
        completed: data.completed ?? true,
      },
    });
    return NextResponse.json({ session }, { status: 201 });
  } catch (e) {
    if (e instanceof Response) return e;
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
