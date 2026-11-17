import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/shared/lib/prisma";
import { requireUserId } from "@/shared/lib/session";

const createSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(20000).optional(),
  tags: z.array(z.string()).optional(),
});

export async function GET() {
  try {
    const userId = await requireUserId();
    const prisma = getPrisma();
    const notes = await prisma.note.findMany({
      where: { userId },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    });
    return NextResponse.json({
      notes: notes.map((n) => ({
        ...n,
        tags: JSON.parse(n.tags || "[]") as string[],
      })),
    });
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
    const note = await prisma.note.create({
      data: {
        userId,
        title: data.title,
        body: data.body ?? "",
        tags: JSON.stringify(data.tags ?? []),
      },
    });
    return NextResponse.json(
      { note: { ...note, tags: data.tags ?? [] } },
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
