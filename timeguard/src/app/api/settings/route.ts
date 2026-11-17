import { NextResponse } from "next/server";
import { z } from "zod";
import { isCurrency } from "@/shared/lib/currencies";
import { getPrisma } from "@/shared/lib/prisma";
import { requireUserId } from "@/shared/lib/session";

const patchSchema = z.object({
  theme: z.enum(["system", "light", "dark"]).optional(),
  locale: z.enum(["ru", "en"]).optional(),
  accent: z.enum(["teal", "lime", "amber", "sky", "rose"]).optional(),
  density: z.enum(["comfortable", "compact"]).optional(),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]).optional(),
  pomodoroFocus: z.number().int().min(1).max(180).optional(),
  pomodoroBreak: z.number().int().min(1).max(60).optional(),
  pomodoroLong: z.number().int().min(1).max(90).optional(),
  pomodoroCycles: z.number().int().min(1).max(12).optional(),
  soundEnabled: z.boolean().optional(),
  baseCurrency: z.string().refine(isCurrency).optional(),
});

export async function GET() {
  try {
    const userId = await requireUserId();
    const prisma = getPrisma();
    let settings = await prisma.userSettings.findUnique({ where: { userId } });
    if (!settings) {
      settings = await prisma.userSettings.create({ data: { userId } });
    }
    return NextResponse.json({ settings });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const userId = await requireUserId();
    const data = patchSchema.parse(await req.json());
    const prisma = getPrisma();
    const settings = await prisma.userSettings.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return NextResponse.json({ settings });
  } catch (e) {
    if (e instanceof Response) return e;
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
