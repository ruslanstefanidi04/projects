import { NextResponse } from "next/server";
import { z } from "zod";
import { CATEGORY_SEEDS } from "@/shared/lib/finance-categories";
import { createId } from "@/shared/lib/ids";
import { getPrisma } from "@/shared/lib/prisma";
import { requireUserId } from "@/shared/lib/session";
import { getCopy, isLocale } from "@/shared/i18n";

const createSchema = z.object({
  name: z.string().trim().min(1).max(40),
  emoji: z.string().trim().min(1).max(8),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  kind: z.enum(["expense", "income", "both"]),
});

async function seedIfEmpty(userId: string) {
  const prisma = getPrisma();
  const count = await prisma.financeCategory.count({ where: { userId } });
  if (count > 0) return;
  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  const locale = settings && isLocale(settings.locale) ? settings.locale : "ru";
  const labels = getCopy(locale).finance.categories as Record<string, string>;
  await prisma.financeCategory.createMany({
    data: CATEGORY_SEEDS.map((seed) => ({
      userId,
      key: seed.key,
      name: labels[seed.key] ?? seed.key,
      emoji: seed.emoji,
      color: seed.color,
      kind: seed.kind,
      builtin: true,
    })),
  });
}

export async function GET() {
  try {
    const userId = await requireUserId();
    await seedIfEmpty(userId);
    const prisma = getPrisma();
    const categories = await prisma.financeCategory.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ categories });
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
    const category = await prisma.financeCategory.create({
      data: {
        userId,
        key: `c_${createId()}`,
        name: data.name,
        emoji: data.emoji,
        color: data.color.toLowerCase(),
        kind: data.kind,
        builtin: false,
      },
    });
    return NextResponse.json({ category }, { status: 201 });
  } catch (e) {
    if (e instanceof Response) return e;
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
