import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/shared/lib/prisma";
import { requireUserId } from "@/shared/lib/session";

const createSchema = z.object({
  kind: z.enum(["income", "expense"]),
  amount: z.number().positive().max(1_000_000_000),
  currency: z.string().min(3).max(3).optional(),
  category: z.string().min(1).max(60),
  title: z.string().max(200).optional(),
  note: z.string().max(2000).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function GET(req: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const kind = url.searchParams.get("kind");
    const prisma = getPrisma();

    const txs = await prisma.financeTx.findMany({
      where: {
        userId,
        ...(kind === "income" || kind === "expense" ? { kind } : {}),
        ...(from || to
          ? {
              date: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    });
    return NextResponse.json({ transactions: txs });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const userId = await requireUserId();
    const prisma = getPrisma();
    const result = await prisma.financeTx.deleteMany({ where: { userId } });
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
    const prisma = getPrisma();
    const tx = await prisma.financeTx.create({
      data: {
        userId,
        kind: data.kind,
        amount: data.amount,
        currency: (data.currency ?? "USD").toUpperCase(),
        category: data.category,
        title: data.title ?? "",
        note: data.note ?? "",
        date: data.date,
      },
    });
    return NextResponse.json({ transaction: tx }, { status: 201 });
  } catch (e) {
    if (e instanceof Response) return e;
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
